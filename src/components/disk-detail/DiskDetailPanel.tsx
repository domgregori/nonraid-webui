import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { nmdApi } from '../../api/nmdApi';
import { useDiskSmart } from '../../hooks/useDiskSmart';
import { useSettings } from '../../hooks/useSettings';
import { deriveDisks } from '../../selectors/disks';
import { useArrayStatus } from '../../state/useArrayStatus';
import { COLORS } from '../../styles/colors';
import { ArrayActionErrorBanner } from '../shared/ArrayActionErrorBanner';
import { ProgressBar } from '../shared/ProgressBar';
import { BenchmarkSection } from './BenchmarkSection';
import { EmptyDiskDialog } from './EmptyDiskDialog';
import { ReplaceDiskDialog } from './ReplaceDiskDialog';
import { ShrinkArrayDialog } from './ShrinkArrayDialog';
import { SmartOverviewRows } from './SmartOverviewRows';
import type { SelfTestType } from '../../types/smart';

type SmartTab = 'overview' | 'attributes' | 'capabilities';

export function DiskDetailPanel() {
  const { t } = useTranslation('diskDetail');
  const boolLabel = (v: boolean | null): string => (v === null ? '-' : v ? t('DiskDetailPanel.yes') : t('DiskDetailPanel.no'));
  const SELF_TEST_LABELS: Record<SelfTestType, string> = {
    short: t('DiskDetailPanel.shortTest'),
    long: t('DiskDetailPanel.longTest'),
    conveyance: t('DiskDetailPanel.conveyanceTest'),
  };
  const {
    status,
    temps,
    diskHealths,
    diskTypes,
    spinStates,
    selectedDiskId,
    actionNote,
    actionError,
    stopBlockedByContainers,
    unassignPending,
    restorePending,
    closeDetail,
    unassignDisk,
    restoreDisk,
  } = useArrayStatus();
  const { settings, update: updateSettings } = useSettings();
  const { all } = status ? deriveDisks(status, temps, diskHealths, diskTypes, spinStates, settings?.diskLabels ?? {}) : { all: [] };
  const disk = selectedDiskId ? all.find((d) => d.id === selectedDiskId) : undefined;

  const smartSlot = disk && disk.device && disk.device !== 'none' ? disk.slot : null;
  const { attributes, status: smartStatus, error: smartError, testPending, startSelfTest } = useDiskSmart(smartSlot);
  const [smartTab, setSmartTab] = useState<SmartTab>('overview');
  const [formatPending, setFormatPending] = useState(false);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [formatWarning, setFormatWarning] = useState<string | null>(null);
  const [mountPending, setMountPending] = useState(false);
  const [mountError, setMountError] = useState<string | null>(null);
  const [spinPending, setSpinPending] = useState(false);
  const [spinError, setSpinError] = useState<string | null>(null);
  const [showReplaceDialog, setShowReplaceDialog] = useState(false);
  const [showEmptyDialog, setShowEmptyDialog] = useState(false);
  const [showShrinkDialog, setShowShrinkDialog] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [nicknameSaving, setNicknameSaving] = useState(false);
  const [nicknameError, setNicknameError] = useState<string | null>(null);

  // Re-seeds when the selected disk changes, or when its persisted label value itself changes
  // (e.g. this exact save resolving, or another session's edit) - but deliberately not on every
  // settings/status poll tick, since `disk` is a freshly-derived object every render and depending
  // on it directly would reset the draft out from under whatever the user is mid-typing.
  useEffect(() => {
    setNicknameDraft(disk?.customLabel ?? '');
    setNicknameError(null);
  }, [selectedDiskId, disk?.customLabel]);

  if (!selectedDiskId || !status || !disk) return null;

  const saveNickname = async () => {
    setNicknameSaving(true);
    setNicknameError(null);
    try {
      await updateSettings({ diskLabels: { [disk.diskId]: nicknameDraft.trim() } });
    } catch (err) {
      setNicknameError((err as Error).message);
    } finally {
      setNicknameSaving(false);
    }
  };

  const arrayStarted = status.array.state === 'STARTED';
  // nmdctl only reports a disk's real filesystem type once the array is started and the disk is
  // actually mounted - while stopped, fsType/mountpoint come back blank/"unknown" for every disk
  // regardless of what's really on it, so none of this is trustworthy until arrayStarted.
  const needsFormat = arrayStarted && disk.role === 'data' && disk.fsType === 'UNKNOWN';
  // nmdctl's own JSON status reports an unmounted filesystem's mountpoint as the literal word
  // "unmounted", not "-" - confirmed against tools/nmdctl's get_mountpoint()/DISK_STATUS_DATA
  // default. selectors/disks.ts's normalize() only collapses "-"/empty to "-", so "unmounted"
  // passes through unchanged and needs its own check here too, or a disk with a real but
  // never-mounted-by-this-app filesystem (e.g. reused from another system) never shows Mount
  // Disk or Force Format at all - confirmed live, this exact state was unreachable before this fix.
  const needsMount = arrayStarted && disk.role === 'data' && !needsFormat && (disk.mountpoint === '-' || disk.mountpoint === 'unmounted');
  // Same trigger as needsMount - a recognized filesystem that isn't mounted here means either
  // "Mount Disk" hasn't been tried yet, or it's foreign data (e.g. ext4/ntfs from another system)
  // that this app's mount step can never bring up. Offered alongside Mount Disk rather than
  // instead of it, since a real prior array member can land in this same state.
  const canForceFormat = needsMount;
  // Unassigned but not yet committed via a start since - the disk's identity
  // is still intact and restoreUnassignedDisk() can put it back with no
  // clear/rebuild involved. Once a start commits it, this stops applying.
  const isRestorable = disk.rawStatus === 'DISK_NP_MISSING' && !arrayStarted;
  // Committed-unassigned - identity already cleared, restore no longer applies.
  // This is the only state shrinkArray() can drop, so it's the only state that offers it.
  const isDroppable = disk.role === 'data' && disk.rawStatus === 'DISK_NP_DSBL';

  const handleFormat = async () => {
    setFormatPending(true);
    setFormatError(null);
    setFormatWarning(null);
    try {
      await nmdApi.formatDisk(disk.slot);
    } catch (err) {
      const message = (err as Error).message;
      // formatDisk() itself refuses without force the moment it sees a recognized filesystem
      // already on the disk - a real safety backstop for a disk added by mistake, but not
      // something to make the user click through a second confirmation dialog for every time
      // (this is exactly what the danger-styled "Force Format" flow below used to require).
      // Retrying once with force and surfacing what happened as a plain note instead of an
      // error covers it in one click.
      if (/already has a filesystem/i.test(message)) {
        try {
          await nmdApi.formatDisk(disk.slot, true);
          setFormatWarning(t('DiskDetailPanel.formatWarning', { fsType: disk.fsType }));
        } catch (err2) {
          setFormatError((err2 as Error).message);
        }
      } else {
        setFormatError(message);
      }
    } finally {
      setFormatPending(false);
    }
  };

  const handleMount = async () => {
    setMountPending(true);
    setMountError(null);
    try {
      await nmdApi.mountDisk(disk.slot);
    } catch (err) {
      setMountError((err as Error).message);
    } finally {
      setMountPending(false);
    }
  };

  const handleSpinDown = async () => {
    setSpinPending(true);
    setSpinError(null);
    try {
      await nmdApi.spinDownDisk(disk.slot);
    } catch (err) {
      setSpinError((err as Error).message);
    } finally {
      setSpinPending(false);
    }
  };

  const handleSpinUp = async () => {
    setSpinPending(true);
    setSpinError(null);
    try {
      await nmdApi.spinUpDisk(disk.slot);
    } catch (err) {
      setSpinError((err as Error).message);
    } finally {
      setSpinPending(false);
    }
  };

  return (
    <>
      <div className="detail-overlay" onClick={closeDetail} />
      <div className="detail-panel">
        <div className="detail-panel__head">
          <div className="detail-panel__title">{disk.label}</div>
          <button type="button" className="detail-panel__close" onClick={closeDetail} aria-label={t('DiskDetailPanel.close')}>
            &#10005;
          </button>
        </div>

        <div className="detail-panel__status">
          <span className="detail-panel__status-dot" style={{ background: disk.statusColor }} />
          <span className="detail-panel__status-text" style={{ color: disk.statusColor }}>
            {disk.statusLabel}
          </span>
        </div>

        <div className="detail-panel__body">
          <div className="detail-card">
            <div className="settings-field">
              <div className="toggle-row__title">{t('DiskDetailPanel.nickname')}</div>
              <div className="settings-field__row">
                <input
                  className="history-input"
                  style={{ width: '100%' }}
                  value={nicknameDraft}
                  onChange={(e) => setNicknameDraft(e.target.value)}
                  placeholder={t('DiskDetailPanel.nicknamePlaceholder')}
                  maxLength={40}
                />
                <button type="button" className="btn" disabled={nicknameSaving || nicknameDraft.trim() === (disk.customLabel ?? '')} onClick={saveNickname}>
                  {nicknameSaving ? t('DiskDetailPanel.saving') : t('DiskDetailPanel.save')}
                </button>
              </div>
              {nicknameError && <div className="status-note status-note--error">{nicknameError}</div>}
            </div>

            <div className="eyebrow">{t('DiskDetailPanel.info')}</div>
            <div className="detail-rows">
              <div className="detail-row">
                <span className="detail-row__label">{t('DiskDetailPanel.slot')}</span>
                <span className="detail-row__value">{disk.slot}</span>
              </div>
              <div className="detail-row">
                <span className="detail-row__label">{t('DiskDetailPanel.device')}</span>
                <span className="detail-row__value">{disk.device}</span>
              </div>
              <div className="detail-row">
                <span className="detail-row__label">{t('DiskDetailPanel.size')}</span>
                <span className="detail-row__value">{disk.sizeLabel}</span>
              </div>
              <div className="detail-row">
                <span className="detail-row__label">{t('DiskDetailPanel.used')}</span>
                <span className="detail-row__value">{t('DiskDetailPanel.usedWithFree', { used: disk.usedLabel, free: disk.freeLabel })}</span>
              </div>
              <div className="detail-row">
                <span className="detail-row__label">{t('DiskDetailPanel.filesystem')}</span>
                <span className="detail-row__value">{disk.fsType}</span>
              </div>
              <div className="detail-row">
                <span className="detail-row__label">{t('DiskDetailPanel.mountpoint')}</span>
                <span className="detail-row__value">{disk.mountpoint}</span>
              </div>
              <div className="detail-row">
                <span className="detail-row__label">{t('DiskDetailPanel.temperature')}</span>
                <span className="detail-row__value" style={{ color: disk.tempColor }}>
                  {disk.tempLabel}
                </span>
              </div>
            </div>
          </div>

          {smartSlot !== null && (
            <div className="detail-card">
              <div className="eyebrow">{t('DiskDetailPanel.smart')}</div>

              {smartStatus === 'loading' && <div className="status-note">{t('DiskDetailPanel.loadingSmart')}</div>}
              {smartError && <div className="status-note status-note--error">{smartError}</div>}
              {smartStatus === 'ready' && !attributes && <div className="status-note">{t('DiskDetailPanel.noSmartData')}</div>}

              {attributes && (
                <>
                  <div className="smart-tabs">
                  {(['overview', 'attributes', 'capabilities'] as SmartTab[]).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      className={`smart-tabs__btn${smartTab === tab ? ' smart-tabs__btn--active' : ''}`}
                      onClick={() => setSmartTab(tab)}
                    >
                      {tab === 'overview' ? t('DiskDetailPanel.overview') : tab === 'attributes' ? t('DiskDetailPanel.attributes') : t('DiskDetailPanel.capabilities')}
                    </button>
                  ))}
                </div>

                {smartTab === 'overview' && (
                  <>
                    <SmartOverviewRows attributes={attributes} typeLabel={disk.typeLabel} />

                    <div className="smart-selftest">
                      <div className="smart-selftest__head">
                        <span className="detail-row__label">{t('DiskDetailPanel.selfTest')}</span>
                        <span className="detail-row__value">
                          {attributes.selfTest.state === 'running'
                            ? `${attributes.selfTest.type ?? t('DiskDetailPanel.testFallback')} · ${attributes.selfTest.progressPct ?? 0}%`
                            : (attributes.selfTest.statusText ?? t('DiskDetailPanel.idle'))}
                        </span>
                      </div>
                      {attributes.selfTest.state === 'running' && (
                        <ProgressBar pct={attributes.selfTest.progressPct ?? 0} color={COLORS.blue} height={6} />
                      )}
                      <div className="smart-selftest__actions">
                        {(['short', 'long', 'conveyance'] as SelfTestType[])
                          .filter((type) => attributes.capabilities[type])
                          .map((type) => (
                            <button
                              key={type}
                              type="button"
                              className="btn"
                              disabled={testPending || attributes.selfTest.state === 'running'}
                              onClick={() => startSelfTest(type)}
                            >
                              {SELF_TEST_LABELS[type]}
                            </button>
                          ))}
                      </div>
                    </div>

                    {attributes.selfTestHistory.length > 0 && (
                      <div className="smart-history">
                        <div className="detail-row__label">{t('DiskDetailPanel.recentSelfTests')}</div>
                        {attributes.selfTestHistory.map((entry, i) => (
                          <div className="smart-history__row" key={i}>
                            <span>{entry.type}</span>
                            <span style={{ color: entry.passed === false ? COLORS.red : COLORS.textSecondary }}>{entry.status}</span>
                            <span>{entry.lifetimeHours != null ? `${entry.lifetimeHours}h` : '-'}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {smartTab === 'attributes' && (
                  <div className="smart-attr-table">
                    {attributes.rawAttributes.length === 0 && <div className="status-note">{t('DiskDetailPanel.noRawAttributes')}</div>}
                    {attributes.rawAttributes.length > 0 && (
                      <div className="smart-attr-table__scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>{t('DiskDetailPanel.colId')}</th>
                              <th>{t('DiskDetailPanel.colAttribute')}</th>
                              <th>{t('DiskDetailPanel.colValue')}</th>
                              <th>{t('DiskDetailPanel.colWorst')}</th>
                              <th>{t('DiskDetailPanel.colThresh')}</th>
                              <th>{t('DiskDetailPanel.colType')}</th>
                              <th>{t('DiskDetailPanel.colRaw')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {attributes.rawAttributes.map((a) => (
                              <tr key={a.id}>
                                <td>{a.id}</td>
                                <td>{a.name.replace(/_/g, ' ')}</td>
                                <td>{a.value ?? '-'}</td>
                                <td>{a.worst ?? '-'}</td>
                                <td>{a.threshold ?? '-'}</td>
                                <td>{a.type ?? '-'}</td>
                                <td style={{ color: a.whenFailed !== 'Never' ? COLORS.red : undefined }}>{a.rawString ?? a.rawValue ?? '-'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {smartTab === 'capabilities' && (
                  <div className="detail-rows">
                    <div className="detail-row">
                      <span className="detail-row__label">{t('DiskDetailPanel.offlineDataCollection')}</span>
                      <span className="detail-row__value">{attributes.capabilitiesInfo.offlineDataCollectionStatus ?? '-'}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">{t('DiskDetailPanel.offlineCollectionTime')}</span>
                      <span className="detail-row__value">
                        {attributes.capabilitiesInfo.offlineDataCollectionSeconds != null
                          ? `${attributes.capabilitiesInfo.offlineDataCollectionSeconds}s`
                          : '-'}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">{t('DiskDetailPanel.lastSelfTestResult')}</span>
                      <span className="detail-row__value">{attributes.capabilitiesInfo.selfTestExecutionStatus ?? '-'}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">{t('DiskDetailPanel.shortTestPolling')}</span>
                      <span className="detail-row__value">
                        {attributes.capabilitiesInfo.shortSelfTestPollingMinutes != null
                          ? `${attributes.capabilitiesInfo.shortSelfTestPollingMinutes} min`
                          : '-'}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">{t('DiskDetailPanel.extendedTestPolling')}</span>
                      <span className="detail-row__value">
                        {attributes.capabilitiesInfo.extendedSelfTestPollingMinutes != null
                          ? `${attributes.capabilitiesInfo.extendedSelfTestPollingMinutes} min`
                          : '-'}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">{t('DiskDetailPanel.selfTestSupported')}</span>
                      <span className="detail-row__value">{boolLabel(attributes.capabilitiesInfo.selfTestSupported)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">{t('DiskDetailPanel.conveyanceSupported')}</span>
                      <span className="detail-row__value">{boolLabel(attributes.capabilitiesInfo.conveyanceSelfTestSupported)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">{t('DiskDetailPanel.selectiveSelfTest')}</span>
                      <span className="detail-row__value">{boolLabel(attributes.capabilitiesInfo.selectiveSelfTestSupported)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">{t('DiskDetailPanel.offlineSurfaceScan')}</span>
                      <span className="detail-row__value">{boolLabel(attributes.capabilitiesInfo.offlineSurfaceScanSupported)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">{t('DiskDetailPanel.attributeAutosave')}</span>
                      <span className="detail-row__value">{boolLabel(attributes.capabilitiesInfo.attributeAutosaveEnabled)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">{t('DiskDetailPanel.errorLogging')}</span>
                      <span className="detail-row__value">{boolLabel(attributes.capabilitiesInfo.errorLoggingSupported)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">{t('DiskDetailPanel.generalPurposeLogging')}</span>
                      <span className="detail-row__value">{boolLabel(attributes.capabilitiesInfo.generalPurposeLoggingSupported)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">{t('DiskDetailPanel.sctStatus')}</span>
                      <span className="detail-row__value">{boolLabel(attributes.capabilitiesInfo.sctStatusSupported)}</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          )}

          {smartSlot !== null && (
            <BenchmarkSection
              onRead={(durationSeconds) => nmdApi.benchmarkRead(disk.slot, durationSeconds)}
              onWrite={disk.role === 'data' ? (durationSeconds) => nmdApi.benchmarkWrite(disk.slot, durationSeconds) : undefined}
            />
          )}
        </div>

        {isRestorable && (
          <div className="status-note status-note--error">
            {t('DiskDetailPanel.restorableNotice')}
            <div className="detail-actions">
              <button
                type="button"
                className="btn btn--block"
                disabled={restorePending}
                onClick={() => restoreDisk(disk.slot)}
                title={t('DiskDetailPanel.restoreTitle')}
              >
                {restorePending ? t('DiskDetailPanel.restoring') : t('DiskDetailPanel.restoreThisDisk')}
              </button>
            </div>
          </div>
        )}

        {isDroppable && (
          <div className="status-note status-note--error">
            {t('DiskDetailPanel.droppableNotice')}
            <div className="detail-actions">
              <button
                type="button"
                className="btn btn--block btn--danger"
                onClick={() => setShowShrinkDialog(true)}
                title={t('DiskDetailPanel.reconfigureTitle')}
              >
                {t('DiskDetailPanel.reconfigureButton')}
              </button>
            </div>
          </div>
        )}

        <div className="detail-actions">
          {needsFormat && (
            <>
              <button
                type="button"
                className="btn btn--block"
                disabled={formatPending}
                onClick={handleFormat}
                title={t('DiskDetailPanel.formatDiskTitle')}
              >
                {formatPending ? t('DiskDetailPanel.formatting') : t('DiskDetailPanel.formatDiskXfs')}
              </button>
            </>
          )}
          {needsMount && (
            <>
              <button
                type="button"
                className="btn btn--block"
                disabled={mountPending}
                onClick={handleMount}
                title={t('DiskDetailPanel.mountDiskTitle', { slot: disk.slot })}
              >
                {mountPending ? t('DiskDetailPanel.mounting') : t('DiskDetailPanel.mountDisk')}
              </button>
              {mountError && <div className="status-note status-note--error">{mountError}</div>}
            </>
          )}
          {canForceFormat && (
            <button
              type="button"
              className="btn btn--block btn--danger"
              disabled={formatPending}
              onClick={handleFormat}
              title={t('DiskDetailPanel.forceFormatTitle')}
            >
              {formatPending ? t('DiskDetailPanel.formatting') : t('DiskDetailPanel.forceFormat')}
            </button>
          )}
          {(formatError || formatWarning) && (
            <div className={`status-note${formatError ? ' status-note--error' : ''}`}>{formatError ?? formatWarning}</div>
          )}
          {disk.role === 'data' && !needsFormat && (
            <button
              type="button"
              className="btn btn--block"
              onClick={() => setShowEmptyDialog(true)}
              title={t('DiskDetailPanel.emptyDiskTitle')}
            >
              {t('DiskDetailPanel.emptyDisk')}
            </button>
          )}
          {disk.isSSD === false && disk.status === 'active' && (
            <>
              {attributes?.spinState === 'standby' ? (
                <button
                  type="button"
                  className="btn btn--block"
                  disabled={spinPending}
                  onClick={handleSpinUp}
                  title={t('DiskDetailPanel.spinUpTitle')}
                >
                  {spinPending ? t('DiskDetailPanel.spinningUp') : t('DiskDetailPanel.spinUp')}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--block"
                  disabled={spinPending || status.resync.active}
                  onClick={handleSpinDown}
                  title={t('DiskDetailPanel.spinDownTitle')}
                >
                  {spinPending ? t('DiskDetailPanel.spinningDown') : t('DiskDetailPanel.spinDown')}
                </button>
              )}
              {spinError && <div className="status-note status-note--error">{spinError}</div>}
            </>
          )}
          <button
            type="button"
            className="btn btn--block"
            onClick={() => setShowReplaceDialog(true)}
            title={t('DiskDetailPanel.replaceDiskTitle')}
          >
            {t('DiskDetailPanel.replaceDisk')}
          </button>
          <button
            type="button"
            className="btn btn--block btn--danger"
            disabled={unassignPending || isRestorable}
            onClick={() => unassignDisk(disk.slot)}
            title={t('DiskDetailPanel.unassignDiskTitle')}
          >
            {unassignPending ? t('DiskDetailPanel.unassigning') : t('DiskDetailPanel.unassignDisk')}
          </button>
        </div>

        {actionNote && <div className="detail-note">{actionNote}</div>}
        {actionError && <ArrayActionErrorBanner actionError={actionError} stopBlockedByContainers={stopBlockedByContainers} />}
      </div>

      {showReplaceDialog && (
        <ReplaceDiskDialog slot={disk.slot} label={disk.label} onClose={() => setShowReplaceDialog(false)} onDone={() => {}} />
      )}
      {showEmptyDialog && (
        <EmptyDiskDialog slot={disk.slot} label={disk.label} onClose={() => setShowEmptyDialog(false)} onStarted={() => {}} />
      )}
      {showShrinkDialog && (
        <ShrinkArrayDialog
          slot={disk.slot}
          label={disk.label}
          onClose={() => setShowShrinkDialog(false)}
          onDone={() => {
            setShowShrinkDialog(false);
            closeDetail();
          }}
        />
      )}
    </>
  );
}
