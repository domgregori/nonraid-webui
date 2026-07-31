import { useEffect, useState } from 'react';
import { appsApi } from '../../api/appsApi';
import type { CaApp, CaConfigEntry, CreateContainerProgress, InstallOverrides, InstallPlan } from '../../types/appsApi';

interface InstallDialogProps {
  appName: string;
  repository: string;
  onClose: () => void;
}

type Stage = 'loading' | 'editing' | 'reviewed' | 'installing' | 'done' | 'load-error';

function isHidden(display: string | undefined): boolean {
  const d = (display ?? '').toLowerCase();
  return d.includes('hide') || d === 'hidden' || d === 'none' || d === 'false';
}

function isAdvanced(display: string | undefined): boolean {
  return (display ?? '').toLowerCase().includes('advanced');
}

function resolveWebUi(template: string | null): string | null {
  if (!template) return null;
  return template.replace('[IP]', window.location.hostname);
}

/**
 * Mirrors backend/src/apps/service.ts's elevatedAccessReasons so the warning
 * banner can appear before the first plan review, not just after — privileged,
 * host networking, and raw device passthrough are all host-access escalations
 * of comparable severity, so they share one ack rather than only gating on
 * the Privileged flag.
 */
function preReviewElevatedReasons(app: CaApp): string[] {
  const reasons: string[] = [];
  if (app.Privileged === 'true') reasons.push('This template runs a privileged container (full host access).');
  if ((app.Config ?? []).some((e) => e['@attributes'].Type === 'Device')) {
    reasons.push('This template passes through a host device directly.');
  }
  if (app.Network === 'host') reasons.push('This template uses host networking (no network isolation from the host).');
  return reasons;
}

export function InstallDialog({ appName, repository, onClose }: InstallDialogProps) {
  const [stage, setStage] = useState<Stage>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [app, setApp] = useState<CaApp | null>(null);
  const [containerName, setContainerName] = useState(appName);
  const [overrides, setOverrides] = useState<InstallOverrides>({});
  const [privilegedAck, setPrivilegedAck] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [plan, setPlan] = useState<InstallPlan | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installMessage, setInstallMessage] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<CreateContainerProgress | null>(null);

  useEffect(() => {
    let mounted = true;
    appsApi
      .getApp(appName, repository)
      .then((a) => {
        if (!mounted) return;
        setApp(a);
        const seeded: InstallOverrides = {};
        for (const entry of a.Config ?? []) {
          const attrs = entry['@attributes'];
          seeded[attrs.Target] = entry.value || attrs.Default || '';
        }
        setOverrides(seeded);
        setStage('editing');
      })
      .catch((err) => {
        if (!mounted) return;
        setLoadError((err as Error).message);
        setStage('load-error');
      });
    return () => {
      mounted = false;
    };
  }, [appName, repository]);

  const setField = (target: string, value: string) => {
    setOverrides((prev) => ({ ...prev, [target]: value }));
    setStage('editing');
    setPlan(null);
  };

  const handleReview = async () => {
    setReviewError(null);
    setStage('loading');
    try {
      const result = await appsApi.planInstall(appName, { repository, containerName, overrides, privilegedAck });
      setPlan(result);
      setStage('reviewed');
    } catch (err) {
      setReviewError((err as Error).message);
      setStage('editing');
    }
  };

  const handleInstall = async () => {
    setInstallError(null);
    setInstallProgress(null);
    setStage('installing');
    try {
      const result = await appsApi.install(appName, { repository, containerName, overrides, privilegedAck }, setInstallProgress);
      setInstallMessage(result.message);
      setStage('done');
    } catch (err) {
      setInstallError((err as Error).message);
      setStage('reviewed');
    }
  };

  const configEntries = (app?.Config ?? []).filter((e) => !isHidden(e['@attributes'].Display) && e['@attributes'].Type !== 'Label');
  const primaryEntries = configEntries.filter((e) => !isAdvanced(e['@attributes'].Display));
  const advancedEntries = configEntries.filter((e) => isAdvanced(e['@attributes'].Display));
  const elevatedReasons = plan?.elevatedAccessReasons ?? (app ? preReviewElevatedReasons(app) : []);
  const needsElevatedAck = elevatedReasons.length > 0;
  // Nothing is editable once install has actually started — show the values
  // that are actually being installed as plain info instead of live inputs.
  const locked = stage === 'installing' || stage === 'done';

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog apps-install-dialog">
        <div className="dialog__head">
          <div className="dialog__title">Install {appName}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        {stage === 'loading' && !app && <div className="status-note">Loading template…</div>}
        {stage === 'load-error' && <div className="status-note status-note--error">{loadError}</div>}

        {app && (
          <div className="dialog__body">
            {app.Overview && <div className="apps-install-overview">{app.Overview.replace(/\r\n/g, '\n').split('\n')[0]}</div>}

            <label className="form-field">
              <span className="form-field__label">Container name</span>
              {locked ? (
                <div className="form-field__value">{containerName}</div>
              ) : (
                <input
                  className="history-input"
                  style={{ width: '100%' }}
                  value={containerName}
                  onChange={(e) => {
                    setContainerName(e.target.value);
                    setPlan(null);
                    setStage('editing');
                  }}
                />
              )}
            </label>

            {needsElevatedAck && (
              <div className="apps-privileged-banner">
                <div className="apps-privileged-banner__title">Requires extra host access</div>
                <div className="apps-privileged-banner__body">
                  {elevatedReasons.map((reason) => (
                    <div key={reason}>{reason}</div>
                  ))}
                  Only install it if you trust the image ({app.Repository}).
                </div>
                <label className="apps-privileged-banner__ack">
                  <input
                    type="checkbox"
                    checked={privilegedAck}
                    onChange={(e) => {
                      setPrivilegedAck(e.target.checked);
                      setPlan(null);
                      setStage('editing');
                    }}
                  />
                  I understand and want to proceed
                </label>
              </div>
            )}

            {primaryEntries.map((entry) => (
              <ConfigField
                key={entry['@attributes'].Target}
                entry={entry}
                value={overrides[entry['@attributes'].Target] ?? ''}
                onChange={setField}
                plan={plan}
                locked={locked}
              />
            ))}

            {advancedEntries.length > 0 && (
              <div className="apps-advanced">
                <button type="button" className="apps-advanced__toggle" onClick={() => setShowAdvanced((v) => !v)}>
                  {showAdvanced ? 'Hide' : 'Show'} advanced settings ({advancedEntries.length})
                </button>
                {showAdvanced &&
                  advancedEntries.map((entry) => (
                    <ConfigField
                      key={entry['@attributes'].Target}
                      entry={entry}
                      value={overrides[entry['@attributes'].Target] ?? ''}
                      onChange={setField}
                      plan={plan}
                      locked={locked}
                    />
                  ))}
              </div>
            )}

            {reviewError && <div className="status-note status-note--error">{reviewError}</div>}

            {stage === 'reviewed' && plan && (
              <div className="apps-plan-review">
                <div className="apps-plan-review__title">Review before installing</div>
                {plan.errors.length > 0 ? (
                  <div className="status-note status-note--error">
                    {plan.errors.map((e) => (
                      <div key={e}>{e}</div>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="apps-plan-review__section">
                      <div className="apps-plan-review__section-title">Container</div>
                      <div className="apps-plan-review__kv">
                        <span className="apps-plan-review__kv-label">Image</span>
                        <span className="apps-plan-review__kv-value">{plan.image}</span>
                      </div>
                      <div className="apps-plan-review__kv">
                        <span className="apps-plan-review__kv-label">Network</span>
                        <span className="apps-plan-review__kv-value">{plan.network}</span>
                      </div>
                    </div>

                    {plan.ports.length > 0 && (
                      <div className="apps-plan-review__section">
                        <div className="apps-plan-review__section-title">Ports</div>
                        {plan.ports.map((p) => (
                          <div className="apps-plan-review__kv" key={p.target}>
                            <span className="apps-plan-review__kv-label">{p.label}</span>
                            <span className="apps-plan-review__kv-value">
                              {p.hostPort} → {p.containerPort}/{p.protocol}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {plan.binds.length > 0 && (
                      <div className="apps-plan-review__section">
                        <div className="apps-plan-review__section-title">Volumes</div>
                        {plan.binds.map((b) => (
                          <div className="apps-plan-review__bind" key={b.target}>
                            <div className="apps-plan-review__bind-label">
                              {b.label}
                              {b.readOnly && <span className="apps-plan-review__badge">RO</span>}
                            </div>
                            <div className="apps-plan-review__bind-path">{b.hostPath}</div>
                            <div className="apps-plan-review__bind-arrow">→ {b.containerPath}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {plan.env.length > 0 && (
                      <div className="apps-plan-review__section">
                        <div className="apps-plan-review__section-title">Environment</div>
                        {plan.env.map((e) => (
                          <div className="apps-plan-review__kv" key={e.target}>
                            <span className="apps-plan-review__kv-label">{e.label}</span>
                            <span className="apps-plan-review__kv-value">{e.masked ? '••••••••' : e.value || '—'}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {plan.webUi && (
                      <div className="apps-plan-review__section">
                        <div className="apps-plan-review__section-title">Web UI</div>
                        <div className="apps-plan-review__kv-value apps-plan-review__weburl">{resolveWebUi(plan.webUi)}</div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {stage === 'installing' && (
              <div className="apps-install-progress">
                <div className="apps-install-progress__status">{installProgress?.message ?? 'Starting…'}</div>
                <div className="apps-install-progress__bar">
                  <div
                    className={`apps-install-progress__bar-fill${installProgress?.percent == null ? ' apps-install-progress__bar-fill--indeterminate' : ''}`}
                    style={installProgress?.percent != null ? { width: `${installProgress.percent}%` } : undefined}
                  />
                </div>
              </div>
            )}

            {installError && <div className="status-note status-note--error">{installError}</div>}

            {stage === 'done' && installMessage && (
              <div className="apps-install-done">
                <div className="status-note">{installMessage}</div>
                {plan?.webUi && (
                  <a className="btn" href={resolveWebUi(plan.webUi) ?? undefined} target="_blank" rel="noreferrer">
                    Open Web UI
                  </a>
                )}
              </div>
            )}

            <div className="dialog__actions">
              <button type="button" className="btn" onClick={onClose}>
                {stage === 'done' ? 'Close' : 'Cancel'}
              </button>
              {stage !== 'done' && stage !== 'reviewed' && stage !== 'installing' && (
                <button type="button" className="btn--primary" disabled={stage === 'loading'} onClick={handleReview}>
                  {stage === 'loading' ? 'Reviewing…' : 'Review'}
                </button>
              )}
              {stage === 'reviewed' && (
                <>
                  <button type="button" className="btn" onClick={handleReview}>
                    Re-check
                  </button>
                  <button
                    type="button"
                    className="btn--primary"
                    disabled={!plan || plan.errors.length > 0 || (plan.requiresPrivilegedAck && !privilegedAck)}
                    onClick={handleInstall}
                  >
                    Confirm install
                  </button>
                </>
              )}
              {stage === 'installing' && (
                <button type="button" className="btn--primary" disabled>
                  {installProgress?.percent != null ? `Installing… ${installProgress.percent}%` : 'Installing…'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

interface ConfigFieldProps {
  entry: CaConfigEntry;
  value: string;
  onChange: (target: string, value: string) => void;
  plan: InstallPlan | null;
  locked: boolean;
}

function ConfigField({ entry, value, onChange, plan, locked }: ConfigFieldProps) {
  const attrs = entry['@attributes'];
  const masked = attrs.Mask === 'true';
  const required = attrs.Required === 'true';

  const bindIssue = plan?.binds.find((b) => b.target === attrs.Target && !b.allowed);
  const deviceIssue = plan?.devices.find((d) => d.target === attrs.Target && !d.allowed);
  const fieldError = bindIssue
    ? `Outside the allowed host directories`
    : deviceIssue
      ? `Must be a /dev/ path`
      : null;

  const label = attrs.Type === 'Port' ? `${attrs.Name} (host port)` : attrs.Name;

  return (
    <label className="form-field">
      <span className="form-field__label">
        {label}
        {required && <span className="apps-required-mark"> *</span>}
      </span>
      {locked ? (
        <div className="form-field__value">{masked ? '••••••••' : value || '—'}</div>
      ) : (
        <input
          className={`history-input${fieldError ? ' apps-field--error' : ''}`}
          style={{ width: '100%' }}
          type={masked ? 'password' : attrs.Type === 'Port' ? 'number' : 'text'}
          value={value}
          onChange={(e) => onChange(attrs.Target, e.target.value)}
        />
      )}
      {attrs.Description && <span className="apps-field__hint">{attrs.Description}</span>}
      {fieldError && <span className="apps-field__hint apps-field__hint--error">{fieldError}</span>}
    </label>
  );
}
