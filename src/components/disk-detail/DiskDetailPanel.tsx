import { useState } from 'react';
import { nmdApi } from '../../api/nmdApi';
import { useDiskSmart } from '../../hooks/useDiskSmart';
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

const SELF_TEST_LABELS: Record<SelfTestType, string> = { short: 'Short Test', long: 'Long Test', conveyance: 'Conveyance Test' };

type SmartTab = 'overview' | 'attributes' | 'capabilities';

function boolLabel(v: boolean | null): string {
  return v === null ? '-' : v ? 'Yes' : 'No';
}

export function DiskDetailPanel() {
  const {
    status,
    temps,
    diskHealths,
    diskTypes,
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
  const { all } = status ? deriveDisks(status, temps, diskHealths, diskTypes) : { all: [] };
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

  if (!selectedDiskId || !status || !disk) return null;

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
          setFormatWarning(`Detected an existing ${disk.fsType} filesystem on this disk - formatted over it anyway.`);
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
          <button type="button" className="detail-panel__close" onClick={closeDetail} aria-label="Close">
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
            <div className="eyebrow">Info</div>
            <div className="detail-rows">
              <div className="detail-row">
                <span className="detail-row__label">Slot</span>
                <span className="detail-row__value">{disk.slot}</span>
              </div>
              <div className="detail-row">
                <span className="detail-row__label">Device</span>
                <span className="detail-row__value">{disk.device}</span>
              </div>
              <div className="detail-row">
                <span className="detail-row__label">Size</span>
                <span className="detail-row__value">{disk.sizeLabel}</span>
              </div>
              <div className="detail-row">
                <span className="detail-row__label">Used</span>
                <span className="detail-row__value">{disk.usedLabel}</span>
              </div>
              <div className="detail-row">
                <span className="detail-row__label">Filesystem</span>
                <span className="detail-row__value">{disk.fsType}</span>
              </div>
              <div className="detail-row">
                <span className="detail-row__label">Mountpoint</span>
                <span className="detail-row__value">{disk.mountpoint}</span>
              </div>
              <div className="detail-row">
                <span className="detail-row__label">Temperature</span>
                <span className="detail-row__value" style={{ color: disk.tempColor }}>
                  {disk.tempLabel}
                </span>
              </div>
            </div>
          </div>

          {smartSlot !== null && (
            <div className="detail-card">
              <div className="eyebrow">SMART</div>

              {smartStatus === 'loading' && <div className="status-note">Loading SMART data…</div>}
              {smartError && <div className="status-note status-note--error">{smartError}</div>}
              {smartStatus === 'ready' && !attributes && <div className="status-note">No SMART data available for this disk.</div>}

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
                      {tab === 'overview' ? 'Overview' : tab === 'attributes' ? 'Attributes' : 'Capabilities'}
                    </button>
                  ))}
                </div>

                {smartTab === 'overview' && (
                  <>
                    <SmartOverviewRows attributes={attributes} typeLabel={disk.typeLabel} />

                    <div className="smart-selftest">
                      <div className="smart-selftest__head">
                        <span className="detail-row__label">Self-Test</span>
                        <span className="detail-row__value">
                          {attributes.selfTest.state === 'running'
                            ? `${attributes.selfTest.type ?? 'test'} · ${attributes.selfTest.progressPct ?? 0}%`
                            : (attributes.selfTest.statusText ?? 'Idle')}
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
                        <div className="detail-row__label">Recent Self-Tests</div>
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
                    {attributes.rawAttributes.length === 0 && <div className="status-note">No raw attribute table for this disk.</div>}
                    {attributes.rawAttributes.length > 0 && (
                      <div className="smart-attr-table__scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Attribute</th>
                              <th>Value</th>
                              <th>Worst</th>
                              <th>Thresh</th>
                              <th>Type</th>
                              <th>Raw</th>
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
                      <span className="detail-row__label">Offline Data Collection</span>
                      <span className="detail-row__value">{attributes.capabilitiesInfo.offlineDataCollectionStatus ?? '-'}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">Offline Collection Time</span>
                      <span className="detail-row__value">
                        {attributes.capabilitiesInfo.offlineDataCollectionSeconds != null
                          ? `${attributes.capabilitiesInfo.offlineDataCollectionSeconds}s`
                          : '-'}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">Last Self-Test Result</span>
                      <span className="detail-row__value">{attributes.capabilitiesInfo.selfTestExecutionStatus ?? '-'}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">Short Test Polling</span>
                      <span className="detail-row__value">
                        {attributes.capabilitiesInfo.shortSelfTestPollingMinutes != null
                          ? `${attributes.capabilitiesInfo.shortSelfTestPollingMinutes} min`
                          : '-'}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">Extended Test Polling</span>
                      <span className="detail-row__value">
                        {attributes.capabilitiesInfo.extendedSelfTestPollingMinutes != null
                          ? `${attributes.capabilitiesInfo.extendedSelfTestPollingMinutes} min`
                          : '-'}
                      </span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">Self-Test Supported</span>
                      <span className="detail-row__value">{boolLabel(attributes.capabilitiesInfo.selfTestSupported)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">Conveyance Supported</span>
                      <span className="detail-row__value">{boolLabel(attributes.capabilitiesInfo.conveyanceSelfTestSupported)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">Selective Self-Test</span>
                      <span className="detail-row__value">{boolLabel(attributes.capabilitiesInfo.selectiveSelfTestSupported)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">Offline Surface Scan</span>
                      <span className="detail-row__value">{boolLabel(attributes.capabilitiesInfo.offlineSurfaceScanSupported)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">Attribute Autosave</span>
                      <span className="detail-row__value">{boolLabel(attributes.capabilitiesInfo.attributeAutosaveEnabled)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">Error Logging</span>
                      <span className="detail-row__value">{boolLabel(attributes.capabilitiesInfo.errorLoggingSupported)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">General Purpose Logging</span>
                      <span className="detail-row__value">{boolLabel(attributes.capabilitiesInfo.generalPurposeLoggingSupported)}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-row__label">SCT Status</span>
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
            This disk was unassigned but the array hasn't been started since - the change isn't committed yet and
            this disk's identity is still intact.
            <div className="detail-actions">
              <button
                type="button"
                className="btn btn--block"
                disabled={restorePending}
                onClick={() => restoreDisk(disk.slot)}
                title="Cancels the pending unassign and puts this disk back exactly as it was - the array hasn't started since, so nothing was actually committed yet."
              >
                {restorePending ? 'Restoring…' : 'Restore This Disk'}
              </button>
            </div>
          </div>
        )}

        {isDroppable && (
          <div className="status-note status-note--error">
            This disk is permanently disabled and no longer part of the array - it still shows up here and counts
            toward DEGRADED because this driver keeps removed slots as placeholders rather than shrinking the array
            automatically. Reconfiguring drops it from the topology for good, at the cost of a full parity rebuild.
            <div className="detail-actions">
              <button
                type="button"
                className="btn btn--block btn--danger"
                onClick={() => setShowShrinkDialog(true)}
                title="Permanently drops this slot from the array topology and rebuilds parity to match - there's no undo."
              >
                Reconfigure Array Without This Disk
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
                title="Creates a fresh XFS filesystem on this disk so it can join the array."
              >
                {formatPending ? 'Formatting…' : 'Format Disk (XFS)'}
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
                title={`Makes this disk's existing filesystem accessible at /mnt/disk${disk.slot}.`}
              >
                {mountPending ? 'Mounting…' : 'Mount Disk'}
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
              title="Wipes this disk's existing (non-array) filesystem and formats it as XFS - destroys everything on it, with no undo."
            >
              {formatPending ? 'Formatting…' : 'Force Format'}
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
              title="Moves this disk's share files onto other array disks, then offers to remove it from the array once it's empty."
            >
              Empty Disk
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
                  title="Wakes this disk from standby."
                >
                  {spinPending ? 'Spinning up…' : 'Spin Up'}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn--block"
                  disabled={spinPending || status.resync.active}
                  onClick={handleSpinDown}
                  title="Spins this disk down to save power while it's idle."
                >
                  {spinPending ? 'Spinning down…' : 'Spin Down'}
                </button>
              )}
              {spinError && <div className="status-note status-note--error">{spinError}</div>}
            </>
          )}
          <button
            type="button"
            className="btn btn--block"
            onClick={() => setShowReplaceDialog(true)}
            title="Swaps in a genuinely different physical disk for this slot - the array rebuilds this disk's data from parity onto the new one."
          >
            Replace Disk
          </button>
          <button
            type="button"
            className="btn btn--block btn--danger"
            disabled={unassignPending || isRestorable}
            onClick={() => unassignDisk(disk.slot)}
            title="Removes this disk from the array. Its data is emulated from parity until you add a replacement, which then rebuilds it back."
          >
            {unassignPending ? 'Unassigning…' : 'Unassign Disk'}
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
