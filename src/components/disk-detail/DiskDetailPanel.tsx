import { useDiskSmart } from '../../hooks/useDiskSmart';
import { deriveDisks } from '../../selectors/disks';
import { useArrayStatus } from '../../state/useArrayStatus';
import { COLORS } from '../../styles/colors';
import { ProgressBar } from '../shared/ProgressBar';
import type { SelfTestType } from '../../types/smart';

const SELF_TEST_LABELS: Record<SelfTestType, string> = { short: 'Short Test', long: 'Long Test', conveyance: 'Conveyance Test' };

export function DiskDetailPanel() {
  const { status, temps, selectedDiskId, actionNote, unassignPending, closeDetail, unassignDisk, replaceDisk } = useArrayStatus();
  const { all } = status ? deriveDisks(status, temps) : { all: [] };
  const disk = selectedDiskId ? all.find((d) => d.id === selectedDiskId) : undefined;

  const smartSlot = disk && disk.device && disk.device !== 'none' ? disk.slot : null;
  const { attributes, status: smartStatus, error: smartError, testPending, startSelfTest } = useDiskSmart(smartSlot);

  if (!selectedDiskId || !status || !disk) return null;

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

        {smartSlot !== null && (
          <div className="smart-section">
            <div className="eyebrow">SMART</div>

            {smartStatus === 'loading' && <div className="status-note">Loading SMART data…</div>}
            {smartError && <div className="status-note status-note--error">{smartError}</div>}
            {smartStatus === 'ready' && !attributes && <div className="status-note">No SMART data available for this disk.</div>}

            {attributes && (
              <>
                <div className="detail-rows">
                  <div className="detail-row">
                    <span className="detail-row__label">Health</span>
                    <span
                      className="detail-row__value"
                      style={{ color: attributes.health === 'failed' ? COLORS.red : attributes.health === 'passed' ? COLORS.green : undefined }}
                    >
                      {attributes.health === 'failed' ? 'FAILED' : attributes.health === 'passed' ? 'Passed' : '—'}
                    </span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-row__label">Power-On Hours</span>
                    <span className="detail-row__value">{attributes.powerOnHours ?? '—'}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-row__label">Power Cycles</span>
                    <span className="detail-row__value">{attributes.powerCycleCount ?? '—'}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-row__label">Reallocated Sectors</span>
                    <span className="detail-row__value">{attributes.reallocatedSectors ?? '—'}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-row__label">Pending Sectors</span>
                    <span className="detail-row__value">{attributes.pendingSectors ?? '—'}</span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-row__label">Uncorrectable</span>
                    <span className="detail-row__value">{attributes.uncorrectableSectors ?? '—'}</span>
                  </div>
                </div>

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
                        <span>{entry.lifetimeHours != null ? `${entry.lifetimeHours}h` : '—'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="detail-actions">
          <button type="button" className="btn btn--block" onClick={() => replaceDisk(disk.slot)}>
            Replace Disk
          </button>
          <button
            type="button"
            className="btn btn--block btn--danger"
            disabled={unassignPending}
            onClick={() => unassignDisk(disk.slot)}
          >
            {unassignPending ? 'Unassigning…' : 'Unassign Disk'}
          </button>
        </div>

        {actionNote && <div className="detail-note">{actionNote}</div>}
      </div>
    </>
  );
}
