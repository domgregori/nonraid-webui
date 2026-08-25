import { useEffect, useState } from 'react';
import { systemApi } from '../../api/systemApi';
import { updateApi } from '../../api/updateApi';
import type { ApplyResult, ComponentUpdateStatus, UpdateComponent, UpdateStatus } from '../../types/updateApi';
import { formatRelativeTime } from '../../utils/format';

const COMPONENTS: { key: UpdateComponent; label: string }[] = [
  { key: 'nonraid', label: 'NonRAID driver' },
  { key: 'nonraidWebui', label: 'NonRAID WebUI' },
];

// Same poll shape as ConfigRestoreWizard.tsx's own restart-reconnect loop - reused here for the
// nonraid-webui update path, which ends the same way (this backend restarting itself).
const RESTART_POLL_INTERVAL_MS = 1500;
const RESTART_POLL_MAX_ATTEMPTS = 80;

const CONFIRM_TEXT: Record<UpdateComponent, string> = {
  nonraid:
    'This rebuilds the NonRAID kernel module via DKMS. It only builds it - the running array keeps using the currently-loaded module until you reload it separately from Settings > Services.',
  nonraidWebui:
    'This takes a pre-update snapshot, pulls the new release, rebuilds nonraid-webui, and restarts the backend. Everyone connected will be disconnected for a few seconds while it restarts.',
};

function StatusBadge({ component }: { component: ComponentUpdateStatus }) {
  if (component.checkError) {
    return <span className="job-badge job-badge--error">Check failed</span>;
  }
  if (component.upToDate === true) {
    return <span className="job-badge job-badge--active">Up to date</span>;
  }
  if (component.upToDate === false) {
    return <span className="job-badge job-badge--disabled">Update available</span>;
  }
  return <span className="job-badge">Unknown</span>;
}

export function UpdateSection() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  // Which component's confirm modal is open, if any.
  const [confirming, setConfirming] = useState<UpdateComponent | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  // Covers the nonraid-webui path only - the request resolving successfully means the backend's
  // own self-restart has already been scheduled server-side (it responds before restarting), so
  // a successful resolve reliably means "about to restart", not a race - see updateApi.applyUpdate.
  const [restarting, setRestarting] = useState(false);
  const [backOnline, setBackOnline] = useState(false);
  const [restartTimedOut, setRestartTimedOut] = useState(false);

  const loadStatus = () => updateApi.getStatus().then(setStatus).catch((err) => setLoadError((err as Error).message));

  useEffect(() => {
    loadStatus();
  }, []);

  const checkNow = async () => {
    setChecking(true);
    setCheckError(null);
    try {
      setStatus(await updateApi.checkNow());
    } catch (err) {
      setCheckError((err as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const closeConfirm = () => {
    if (applying) return;
    setConfirming(null);
    setApplyResult(null);
    setApplyError(null);
  };

  const runRestartPoll = async () => {
    for (let attempt = 0; attempt < RESTART_POLL_MAX_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, RESTART_POLL_INTERVAL_MS));
      try {
        await systemApi.getStats();
        setBackOnline(true);
        setRestarting(false);
        loadStatus();
        return;
      } catch {
        // Still restarting - keep polling.
      }
    }
    setRestartTimedOut(true);
    setRestarting(false);
  };

  const handleApply = async (component: UpdateComponent) => {
    setApplying(true);
    setApplyResult(null);
    setApplyError(null);
    try {
      const result = await updateApi.applyUpdate(component);
      setApplyResult(result);
      if (result.ok && component === 'nonraidWebui') {
        setConfirming(null);
        setRestarting(true);
        setBackOnline(false);
        setRestartTimedOut(false);
        runRestartPoll();
        return;
      }
      if (result.ok) {
        loadStatus();
      }
    } catch (err) {
      setApplyError((err as Error).message);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div>
      <div className="toggle-row__desc">
        Checks each component's real GitHub releases for a newer tagged version - not just the tip of
        main. Runs automatically about once a day; "Software update available" can also send a
        notification (Settings → Notifications).
      </div>

      {loadError && <div className="status-note status-note--error">{loadError}</div>}

      {restarting && (
        <div className="status-note">
          Restarting nonraid-webui - this page will reconnect automatically in a few seconds…
        </div>
      )}
      {backOnline && <div className="status-note">nonraid-webui is back online.</div>}
      {restartTimedOut && (
        <div className="status-note status-note--error">
          Still not reachable after a couple of minutes - check the service on the host (`systemctl status nonraid-webui`).
        </div>
      )}

      {status &&
        COMPONENTS.map(({ key, label }) => {
          const component = status[key];
          return (
            <div className="settings-field toggle-row--bordered" key={key}>
              <div className="toggle-row__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {label}
                <StatusBadge component={component} />
              </div>
              <div className="settings-info-row">
                <span className="settings-info-row__label">Installed</span>
                <span className="settings-info-row__value settings-info-row__value--mono">{component.installed ?? 'Not a tagged release'}</span>
              </div>
              <div className="settings-info-row">
                <span className="settings-info-row__label">Latest</span>
                <span className="settings-info-row__value settings-info-row__value--mono">{component.latest ?? 'No releases published yet'}</span>
              </div>
              {component.checkError && <div className="status-note status-note--error">{component.checkError}</div>}
              {component.upToDate === false && (
                <div className="settings-field__row" style={{ marginTop: 8 }}>
                  <button type="button" className="btn" disabled={restarting} onClick={() => setConfirming(key)}>
                    Update Now
                  </button>
                </div>
              )}
            </div>
          );
        })}

      <div className="settings-field__row" style={{ marginTop: 10 }}>
        <button type="button" className="btn" disabled={checking} onClick={checkNow}>
          {checking ? 'Checking…' : 'Check for updates'}
        </button>
        {status?.checkedAt && <span className="settings-field__hint">Last checked {formatRelativeTime(status.checkedAt)}</span>}
      </div>
      {checkError && <div className="status-note status-note--error">{checkError}</div>}

      {confirming && (
        <>
          <div className="detail-overlay" onClick={closeConfirm} />
          <div className="dialog">
            <div className="dialog__head">
              <div className="dialog__title">Update {componentLabel(confirming)}</div>
              <button type="button" className="detail-panel__close" onClick={closeConfirm} aria-label="Close">
                &#10005;
              </button>
            </div>
            <div className="dialog__body">
              <p className="status-note" style={{ margin: '0 0 8px' }}>
                {CONFIRM_TEXT[confirming]}
              </p>
              {applyError && <div className="status-note status-note--error">{applyError}</div>}
              {applyResult && !applyResult.ok && (
                <>
                  <div className="status-note status-note--error">{applyResult.message}</div>
                  <pre className="settings-field__hint" style={{ maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                    {applyResult.output}
                  </pre>
                </>
              )}
              {applyResult?.ok && <div className="status-note">{applyResult.message}</div>}
              <div className="dialog__actions">
                <button type="button" className="btn" disabled={applying} onClick={closeConfirm}>
                  {applyResult?.ok ? 'Close' : 'Cancel'}
                </button>
                {!applyResult?.ok && (
                  <button type="button" className="btn btn--danger" disabled={applying} onClick={() => handleApply(confirming)}>
                    {applying ? 'Updating…' : 'Update Now'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function componentLabel(key: UpdateComponent): string {
  return COMPONENTS.find((c) => c.key === key)?.label ?? key;
}
