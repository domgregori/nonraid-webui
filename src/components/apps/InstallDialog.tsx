import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { appsApi } from '../../api/appsApi';
import { dockerApi } from '../../api/dockerApi';
import { InstallProgress } from '../docker/InstallProgress';
import { installButtonLabel, useInstallProgress } from '../../hooks/useInstallProgress';
import { PathAutocomplete } from '../shared/PathAutocomplete';
import type { CaApp, CaConfigEntry, InstallOverrides, InstallPlan } from '../../types/appsApi';
import type { HostDevice } from '../../types/dockerApi';

// Same sentinel/pattern as ContainerFormDialog's manual-container Device
// picker - a device outside the curated GPU/audio/serial categories (or a
// template default that doesn't match any of them) falls back to free text.
const DEVICE_CUSTOM = '__custom__';

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
 * banner can appear before the first plan review, not just after - privileged,
 * host networking, and raw device passthrough are all host-access escalations
 * of comparable severity, so they share one ack rather than only gating on
 * the Privileged flag.
 */
function preReviewElevatedReasons(app: CaApp, t: (key: string) => string): string[] {
  const reasons: string[] = [];
  if (app.Privileged === 'true') reasons.push(t('InstallDialog.privilegedReason'));
  if ((app.Config ?? []).some((e) => e['@attributes'].Type === 'Device')) {
    reasons.push(t('InstallDialog.deviceReason'));
  }
  if (app.Network === 'host') reasons.push(t('InstallDialog.hostNetworkReason'));
  return reasons;
}

export function InstallDialog({ appName, repository, onClose }: InstallDialogProps) {
  const { t } = useTranslation('apps');
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
  const [availableDevices, setAvailableDevices] = useState<HostDevice[]>([]);
  const { progress: installProgress, log: pullLog, logRef: pullLogRef, onProgress, reset: resetProgress } = useInstallProgress();

  useEffect(() => {
    dockerApi.listDevices().then(setAvailableDevices).catch(() => {});
  }, []);

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
    resetProgress();
    setStage('installing');
    try {
      const result = await appsApi.install(appName, { repository, containerName, overrides, privilegedAck }, onProgress);
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
  const elevatedReasons = plan?.elevatedAccessReasons ?? (app ? preReviewElevatedReasons(app, t) : []);
  const needsElevatedAck = elevatedReasons.length > 0;
  // Nothing is editable once install has actually started - show the values
  // that are actually being installed as plain info instead of live inputs.
  const locked = stage === 'installing' || stage === 'done';

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog apps-install-dialog">
        <div className="dialog__head">
          <div className="dialog__title">{t('InstallDialog.title', { name: appName })}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('InstallDialog.close')}>
            &#10005;
          </button>
        </div>

        {stage === 'loading' && !app && <div className="status-note">{t('InstallDialog.loadingTemplate')}</div>}
        {stage === 'load-error' && <div className="status-note status-note--error">{loadError}</div>}

        {app && (
          <div className="dialog__body">
            {app.Overview && <div className="apps-install-overview">{app.Overview.replace(/\r\n/g, '\n').split('\n')[0]}</div>}

            <label className="form-field">
              <span className="form-field__label">{t('InstallDialog.containerNameLabel')}</span>
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
                <div className="apps-privileged-banner__title">{t('InstallDialog.elevatedAccessTitle')}</div>
                <div className="apps-privileged-banner__body">
                  {elevatedReasons.map((reason) => (
                    <div key={reason}>{reason}</div>
                  ))}
                  {t('InstallDialog.onlyInstallIfTrusted', { repository: app.Repository })}
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
                  {t('InstallDialog.elevatedAccessAck')}
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
                availableDevices={availableDevices}
              />
            ))}

            {advancedEntries.length > 0 && (
              <div className="apps-advanced">
                <button type="button" className="apps-advanced__toggle" onClick={() => setShowAdvanced((v) => !v)}>
                  {t('InstallDialog.advancedToggle', {
                    action: showAdvanced ? t('InstallDialog.hide') : t('InstallDialog.show'),
                    count: advancedEntries.length,
                  })}
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
                      availableDevices={availableDevices}
                    />
                  ))}
              </div>
            )}

            {reviewError && <div className="status-note status-note--error">{reviewError}</div>}

            {stage === 'reviewed' && plan && (
              <div className="apps-plan-review">
                <div className="apps-plan-review__title">{t('InstallDialog.reviewBeforeInstalling')}</div>
                {plan.errors.length > 0 ? (
                  <div className="status-note status-note--error">
                    {plan.errors.map((e) => (
                      <div key={e}>{e}</div>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="apps-plan-review__section">
                      <div className="apps-plan-review__section-title">{t('InstallDialog.containerSection')}</div>
                      <div className="apps-plan-review__kv">
                        <span className="apps-plan-review__kv-label">{t('InstallDialog.imageLabel')}</span>
                        <span className="apps-plan-review__kv-value">{plan.image}</span>
                      </div>
                      <div className="apps-plan-review__kv">
                        <span className="apps-plan-review__kv-label">{t('InstallDialog.networkLabel')}</span>
                        <span className="apps-plan-review__kv-value">{plan.network}</span>
                      </div>
                    </div>

                    {plan.ports.length > 0 && (
                      <div className="apps-plan-review__section">
                        <div className="apps-plan-review__section-title">{t('InstallDialog.portsSection')}</div>
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
                        <div className="apps-plan-review__section-title">{t('InstallDialog.volumesSection')}</div>
                        {plan.binds.map((b) => (
                          <div className="apps-plan-review__bind" key={b.target}>
                            <div className="apps-plan-review__bind-label">
                              {b.label}
                              {b.readOnly && <span className="apps-plan-review__badge">{t('InstallDialog.roLabel')}</span>}
                            </div>
                            <div className="apps-plan-review__bind-path">{b.hostPath}</div>
                            <div className="apps-plan-review__bind-arrow">→ {b.containerPath}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {plan.env.length > 0 && (
                      <div className="apps-plan-review__section">
                        <div className="apps-plan-review__section-title">{t('InstallDialog.environmentSection')}</div>
                        {plan.env.map((e) => (
                          <div className="apps-plan-review__kv" key={e.target}>
                            <span className="apps-plan-review__kv-label">{e.label}</span>
                            <span className="apps-plan-review__kv-value">{e.masked ? '••••••••' : e.value || '-'}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {plan.webUi && (
                      <div className="apps-plan-review__section">
                        <div className="apps-plan-review__section-title">{t('InstallDialog.webUiSection')}</div>
                        <div className="apps-plan-review__kv-value apps-plan-review__weburl">{resolveWebUi(plan.webUi)}</div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {stage === 'installing' && <InstallProgress progress={installProgress} log={pullLog} logRef={pullLogRef} />}

            {installError && <div className="status-note status-note--error">{installError}</div>}

            {stage === 'done' && installMessage && (
              <div className="apps-install-done">
                <div className="status-note">{installMessage}</div>
                {plan?.webUi && (
                  <a className="btn" href={resolveWebUi(plan.webUi) ?? undefined} target="_blank" rel="noreferrer">
                    {t('InstallDialog.openWebUi')}
                  </a>
                )}
              </div>
            )}

            <div className="dialog__actions">
              <button type="button" className="btn" onClick={onClose}>
                {stage === 'done' ? t('InstallDialog.close') : t('InstallDialog.cancel')}
              </button>
              {stage !== 'done' && stage !== 'reviewed' && stage !== 'installing' && (
                <button type="button" className="btn--primary" disabled={stage === 'loading'} onClick={handleReview}>
                  {stage === 'loading' ? t('InstallDialog.reviewing') : t('InstallDialog.review')}
                </button>
              )}
              {stage === 'reviewed' && (
                <>
                  <button type="button" className="btn" onClick={handleReview}>
                    {t('InstallDialog.recheck')}
                  </button>
                  <button
                    type="button"
                    className="btn--primary"
                    disabled={!plan || plan.errors.length > 0 || (plan.requiresPrivilegedAck && !privilegedAck)}
                    onClick={handleInstall}
                  >
                    {t('InstallDialog.confirmInstall')}
                  </button>
                </>
              )}
              {stage === 'installing' && (
                <button type="button" className="btn--primary" disabled>
                  {installButtonLabel(t, installProgress)}
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
  availableDevices: HostDevice[];
}

function ConfigField({ entry, value, onChange, plan, locked, availableDevices }: ConfigFieldProps) {
  const { t } = useTranslation('apps');
  const attrs = entry['@attributes'];
  const masked = attrs.Mask === 'true';
  const required = attrs.Required === 'true';

  const bindIssue = plan?.binds.find((b) => b.target === attrs.Target && !b.allowed);
  const deviceIssue = plan?.devices.find((d) => d.target === attrs.Target && !d.allowed);
  const fieldError = bindIssue
    ? t('InstallDialog.outsideAllowedDirs')
    : deviceIssue
      ? t('InstallDialog.mustBeDevPath')
      : null;

  const label = attrs.Type === 'Port' ? t('InstallDialog.hostPortSuffix', { name: attrs.Name }) : attrs.Name;

  // See ContainerFormDialog's identical device picker for why this isn't keyed on "value === ''" -
  // that would make picking "Custom path…" (which clears value) collapse back to looking unselected.
  const deviceMatched = availableDevices.some((dev) => dev.path === value);
  const deviceSelectValue = deviceMatched ? value : DEVICE_CUSTOM;

  return (
    <label className="form-field">
      <span className="form-field__label">
        {label}
        {required && <span className="apps-required-mark"> *</span>}
      </span>
      {locked ? (
        <div className="form-field__value">{masked ? '••••••••' : value || '-'}</div>
      ) : attrs.Type === 'Path' ? (
        <PathAutocomplete
          scope="binds"
          className={`history-input${fieldError ? ' apps-field--error' : ''}`}
          value={value}
          onChange={(v) => onChange(attrs.Target, v)}
        />
      ) : attrs.Type === 'Device' ? (
        <>
          <select
            className={`history-input${fieldError ? ' apps-field--error' : ''}`}
            style={{ width: '100%' }}
            value={deviceSelectValue}
            onChange={(e) => onChange(attrs.Target, e.target.value === DEVICE_CUSTOM ? '' : e.target.value)}
          >
            {availableDevices.map((dev) => (
              <option key={dev.path} value={dev.path}>
                {dev.label}
              </option>
            ))}
            <option value={DEVICE_CUSTOM}>{t('InstallDialog.customPathOption')}</option>
          </select>
          {deviceSelectValue === DEVICE_CUSTOM && (
            <input
              className={`history-input${fieldError ? ' apps-field--error' : ''}`}
              style={{ width: '100%', marginTop: 6 }}
              placeholder={t('InstallDialog.hostDevicePlaceholder')}
              value={value}
              onChange={(e) => onChange(attrs.Target, e.target.value)}
            />
          )}
        </>
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
