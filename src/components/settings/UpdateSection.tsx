import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { systemApi } from '../../api/systemApi';
import { updateApi } from '../../api/updateApi';
import type { ApplyResult, ComponentUpdateStatus, UpdateComponent, UpdateStatus } from '../../types/updateApi';
import { formatRelativeTime } from '../../utils/format';
import { ChangelogModal } from './ChangelogModal';

const COMPONENTS: { key: UpdateComponent; labelKey: string }[] = [
  { key: 'nonraid', labelKey: 'UpdateSection.nonraidDriver' },
  { key: 'nonraidWebui', labelKey: 'UpdateSection.nonraidWebui' },
];

// Same poll shape as ConfigRestoreWizard.tsx's own restart-reconnect loop - reused here for the
// nonraid-webui update path, which ends the same way (this backend restarting itself).
const RESTART_POLL_INTERVAL_MS = 1500;
const RESTART_POLL_MAX_ATTEMPTS = 80;

const CONFIRM_TEXT_KEYS: Record<UpdateComponent, string> = {
  nonraid: 'UpdateSection.confirmTextNonraid',
  nonraidWebui: 'UpdateSection.confirmTextNonraidWebui',
};

/**
 * `upToDate === false` (a real installed tag that isn't the latest one) is the obvious case, but
 * `installed === null` with a real `latest` is just as actionable and shouldn't read as "unknown" -
 * that's not "can't tell", it's "definitely not on a tagged release, and one exists". Confirmed
 * live: a manually-built/dev install (installed stays null forever until an actual tagged
 * install-webui.sh run sets it) otherwise never shows the update button at all, even once a real
 * release it could move to exists. Genuinely unknown stays unknown: checkError, or latest === null
 * (no releases published yet / couldn't reach GitHub) still fall through to that below.
 */
function hasUpdateAvailable(component: ComponentUpdateStatus): boolean {
  if (component.upToDate === false) return true;
  return component.upToDate === null && component.installed === null && component.latest !== null;
}

function StatusBadge({ component }: { component: ComponentUpdateStatus }) {
  const { t } = useTranslation('settings');
  if (component.checkError) {
    return <span className="job-badge job-badge--error">{t('UpdateSection.checkFailed')}</span>;
  }
  if (component.upToDate === true) {
    return <span className="job-badge job-badge--active">{t('UpdateSection.upToDate')}</span>;
  }
  if (hasUpdateAvailable(component)) {
    return <span className="job-badge job-badge--disabled">{t('UpdateSection.updateAvailable')}</span>;
  }
  return <span className="job-badge">{t('UpdateSection.unknown')}</span>;
}

export function UpdateSection() {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  // Which component's confirm modal is open, if any.
  const [confirming, setConfirming] = useState<UpdateComponent | null>(null);
  // Which component's changelog modal is open, if any.
  const [viewingChangelog, setViewingChangelog] = useState<UpdateComponent | null>(null);
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

  const changelogTag = viewingChangelog ? status?.[viewingChangelog]?.latest : null;

  const componentLabel = (key: UpdateComponent): string => {
    const found = COMPONENTS.find((c) => c.key === key);
    return found ? t(found.labelKey) : key;
  };

  return (
    <div>
      <div className="toggle-row__desc">{t('UpdateSection.checkDesc')}</div>

      {loadError && <div className="status-note status-note--error">{loadError}</div>}

      {restarting && <div className="status-note">{t('UpdateSection.restarting')}</div>}
      {backOnline && <div className="status-note">{t('UpdateSection.backOnline')}</div>}
      {restartTimedOut && <div className="status-note status-note--error">{t('UpdateSection.restartTimedOut')}</div>}

      {status &&
        COMPONENTS.map(({ key, labelKey }) => {
          const component = status[key];
          return (
            <div className="settings-field toggle-row--bordered" key={key}>
              <div className="toggle-row__title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {t(labelKey)}
                <StatusBadge component={component} />
              </div>
              <div className="settings-info-row">
                <span className="settings-info-row__label">{t('UpdateSection.installed')}</span>
                <span className="settings-info-row__value settings-info-row__value--mono">
                  {component.installed ?? t('UpdateSection.notTaggedRelease')}
                </span>
              </div>
              {key === 'nonraid' && (
                <div className="settings-info-row">
                  <span className="settings-info-row__label">{t('UpdateSection.running')}</span>
                  <span className="settings-info-row__value settings-info-row__value--mono">
                    {component.runningMatchesInstalled === true
                      ? (component.installed ?? t('UpdateSection.notTaggedRelease'))
                      : component.runningMatchesInstalled === false
                        ? t('UpdateSection.olderBuild')
                        : t('UpdateSection.unknown')}
                  </span>
                </div>
              )}
              {key === 'nonraidWebui' && (
                <div className="settings-info-row">
                  <span className="settings-info-row__label">{t('UpdateSection.cliTool')}</span>
                  <span className="settings-info-row__value settings-info-row__value--mono">{status.cliTool ?? t('UpdateSection.cliToolNotInstalled')}</span>
                </div>
              )}
              <div className="settings-info-row">
                <span className="settings-info-row__label">{t('UpdateSection.latest')}</span>
                <span className="settings-info-row__value settings-info-row__value--mono">
                  {component.latest ?? t('UpdateSection.noReleasesPublished')}
                  {component.latest && (
                    <button type="button" className="settings-info-row__link" onClick={() => setViewingChangelog(key)}>
                      {t('UpdateSection.changelog')}
                    </button>
                  )}
                </span>
              </div>
              {component.checkError && <div className="status-note status-note--error">{component.checkError}</div>}
              {hasUpdateAvailable(component) && (
                <div className="settings-field__row" style={{ marginTop: 8 }}>
                  <button type="button" className="btn" disabled={restarting} onClick={() => setConfirming(key)}>
                    {t('UpdateSection.updateNow')}
                  </button>
                </div>
              )}
            </div>
          );
        })}

      <div className="settings-field__row" style={{ marginTop: 10 }}>
        <button type="button" className="btn" disabled={checking} onClick={checkNow}>
          {checking ? t('UpdateSection.checking') : t('UpdateSection.checkForUpdates')}
        </button>
        {status?.checkedAt && (
          <span className="settings-field__hint">{t('UpdateSection.lastChecked', { time: formatRelativeTime(status.checkedAt) })}</span>
        )}
      </div>
      {checkError && <div className="status-note status-note--error">{checkError}</div>}

      {confirming && (
        <>
          <div className="detail-overlay" onClick={closeConfirm} />
          <div className="dialog">
            <div className="dialog__head">
              <div className="dialog__title">{t('UpdateSection.updateComponent', { component: componentLabel(confirming) })}</div>
              <button type="button" className="detail-panel__close" onClick={closeConfirm} aria-label={t('UpdateSection.close')}>
                &#10005;
              </button>
            </div>
            <div className="dialog__body">
              <p className="status-note" style={{ margin: '0 0 8px' }}>
                {t(CONFIRM_TEXT_KEYS[confirming])}
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
                  {applyResult?.ok ? t('UpdateSection.close') : t('UpdateSection.cancel')}
                </button>
                {!applyResult?.ok && (
                  <button type="button" className="btn btn--danger" disabled={applying} onClick={() => handleApply(confirming)}>
                    {applying ? t('UpdateSection.updating') : t('UpdateSection.updateNow')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {viewingChangelog && changelogTag && (
        <ChangelogModal component={viewingChangelog} label={componentLabel(viewingChangelog)} tag={changelogTag} onClose={() => setViewingChangelog(null)} />
      )}
    </div>
  );
}
