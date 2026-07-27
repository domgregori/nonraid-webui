import { deriveDisks } from '../../selectors/disks';
import { useArrayStatus } from '../../state/useArrayStatus';

export function DiskDetailPanel() {
  const { status, temps, selectedDiskId, actionNote, unassignPending, closeDetail, unassignDisk, replaceDisk } = useArrayStatus();
  if (!selectedDiskId || !status) return null;

  const { all } = deriveDisks(status, temps);
  const disk = all.find((d) => d.id === selectedDiskId);
  if (!disk) return null;

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
