import { useEffect, useState } from 'react';
import { emptyDiskApi } from '../../api/emptyDiskApi';
import { nmdApi } from '../../api/nmdApi';
import type { EmptyDiskPlanSummary } from '../../types/emptyDisk';
import { formatBytesHuman } from '../../utils/format';

interface EmptyDiskDialogProps {
  slot: number;
  label: string;
  onClose: () => void;
  onStarted: () => void;
}

/**
 * Checks whether a disk's real files can all be relocated onto the array's
 * other disks (per each file's share's own configured disks and allocation
 * method), then - if so - kicks off the actual move as a background job.
 * Deliberately closes as soon as the move starts rather than tracking
 * progress itself: EmptyDiskProgressCard on the Disks page polls the same
 * global job and stays visible even after this dialog is gone, since a real
 * move can take hours.
 */
export function EmptyDiskDialog({ slot, label, onClose, onStarted }: EmptyDiskDialogProps) {
  const [plan, setPlan] = useState<EmptyDiskPlanSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    emptyDiskApi
      .plan(slot)
      .then(setPlan)
      .catch((err) => setError((err as Error).message));
  }, [slot]);

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    try {
      await emptyDiskApi.start(slot);
      onStarted();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setStarting(false);
    }
  };

  // Nothing for Empty Disk to move (no share includes this disk, or the shares
  // that do have no files here right now) - go straight to taking it out of the
  // array instead of leaving the user to find Unassign elsewhere. This only
  // detaches the slot; it never touches whatever bytes are actually on the
  // disk (including any unmanagedBytes reported above), so it's safe even
  // when the disk isn't truly empty in the filesystem sense.
  const handleRemove = async () => {
    setRemoving(true);
    setError(null);
    try {
      const fresh = await nmdApi.getStatus();
      if (fresh.array.state === 'STARTED') {
        await nmdApi.stopArray();
      }
      await nmdApi.unassignDisk(slot);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setRemoving(false);
    }
  };

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">Empty {label} (slot {slot})</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          {!plan && !error && <div className="status-note">Checking whether the data fits on the other disks…</div>}
          {error && <div className="status-note status-note--error">{error}</div>}

          {plan && (
            <>
              <div className="detail-rows">
                <div className="detail-row">
                  <span className="detail-row__label">Files found</span>
                  <span className="detail-row__value">{plan.fileCount.toLocaleString()}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-row__label">Total size</span>
                  <span className="detail-row__value">{formatBytesHuman(plan.totalBytes)}</span>
                </div>
              </div>

              {plan.fileCount === 0 ? (
                <>
                  <div className="status-note status-note--error">
                    Nothing to move - this disk isn't part of any configured share, so there's no file this tool knows
                    how to relocate.
                    {plan.unmanagedBytes > 0 && (
                      <>
                        {' '}
                        It still has {formatBytesHuman(plan.unmanagedBytes)} of real data on it. Removing it from the
                        array only detaches the slot - that data stays on the physical disk, it just won't be reachable
                        through the array anymore.
                      </>
                    )}
                  </div>
                  <div className="status-note">
                    Since there's nothing this tool can move, you can go straight to stopping the array and removing
                    this disk from it.
                  </div>
                </>
              ) : plan.fits ? (
                <>
                  <div className="status-note">
                    Fits - will be redistributed onto:{' '}
                    {Object.entries(plan.perDestinationBytes)
                      .map(([destSlot, bytes]) => `slot ${destSlot} (${formatBytesHuman(bytes)})`)
                      .join(', ')}
                    .
                  </div>
                  {plan.unmanagedBytes > 0 && (
                    <div className="status-note status-note--error">
                      {formatBytesHuman(plan.unmanagedBytes)} on this disk isn't under any share configured for it - this
                      won't be moved, and needs handling manually (see Browse) before this disk is truly empty.
                    </div>
                  )}
                  <div className="status-note status-note--error">
                    This copies every file to its new disk, verifies it, then removes the original - it can take a long
                    time for real data and runs in the background. Watch progress on the Empty Disk card.
                  </div>
                </>
              ) : (
                <>
                  <div className="status-note status-note--error">Doesn't fit: {plan.unfitReason}</div>
                  {plan.unfitExamples.length > 0 && (
                    <pre className="import-raw-output">
                      {plan.unfitExamples.map((f) => `${f.share}/${f.path}  (${formatBytesHuman(f.sizeBytes)})`).join('\n')}
                    </pre>
                  )}
                </>
              )}
            </>
          )}

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onClose}>
              {plan && (plan.fileCount === 0 || plan.fits) ? 'Cancel' : 'Close'}
            </button>
            {plan && plan.fileCount === 0 && (
              <button type="button" className="btn btn--danger" disabled={removing} onClick={handleRemove}>
                {removing ? 'Removing…' : 'Stop Array & Remove Disk'}
              </button>
            )}
            {plan?.fits && plan.fileCount > 0 && (
              <button type="button" className="btn--primary" disabled={starting} onClick={handleStart}>
                {starting ? 'Starting…' : 'Start Emptying'}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
