import { useState } from 'react';
import { diskQueueApi } from '../../api/diskQueueApi';
import { useDiskQueueStatus } from '../../hooks/useDiskQueueStatus';
import { useArrayStatus } from '../../state/useArrayStatus';
import { COLORS } from '../../styles/colors';
import type { DiskQueueItemPhase, DiskQueueItemType } from '../../types/diskQueue';
import type { NmdResyncStatus } from '../../types/nmdApi';
import { Card } from '../shared/Card';
import { ProgressBar } from '../shared/ProgressBar';

// Exact text of the one error DiskQueueService.runAddDiskItem() throws when it declines to stop
// the array because a resync is already active outside the queue's own bookkeeping (see that
// method's doc comment in backend/src/diskQueue/service.ts) — matched below so the failed-item
// block can show live progress instead of leaving the reader to guess where to look.
const EXTERNAL_RESYNC_ERROR = 'A parity check or resync is already active outside the queue — wait for it to finish, then retry.';

function typeLabel(type: DiskQueueItemType): string {
  switch (type) {
    case 'add-parity':
      return 'Add parity disk';
    case 'add-data':
      return 'Add data disk';
    case 'add-cache-mirror':
      return 'Add cache mirror';
  }
}

function phaseText(phase: DiskQueueItemPhase): string {
  switch (phase) {
    case 'committing':
      return 'Committing…';
    case 'awaiting-resync':
      return 'Resyncing…';
    case 'formatting':
      return 'Formatting…';
    default:
      return 'Starting…';
  }
}

function formatEta(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min remaining`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m remaining`;
}

/** Shared live percent/speed/ETA readout for an active resync — used by both the running item's
 *  'awaiting-resync' phase and the failed item's "blocked by an external resync" case below. */
function ResyncProgress({ resync }: { resync: NmdResyncStatus }) {
  return (
    <>
      <ProgressBar pct={Math.round(resync.progress_percent)} color={COLORS.blue} height={8} />
      <div className="parity-card__meta">
        <span>{Math.round(resync.progress_percent)}%</span>
        <span>Speed: {Math.round(resync.rate_mb_s)} MB/s</span>
        <span>{formatEta(resync.eta_seconds)}</span>
      </div>
    </>
  );
}

/**
 * Sits on the Disks page next to Unassigned Devices — see DiskQueueService's own doc comment for
 * the backend engine this displays. Modeled on EmptyDiskProgressCard: renders nothing while the
 * queue is empty (no queued/running/recent-done/failed items), stays out of the way otherwise.
 *
 * For phase 'awaiting-resync' the progress readout comes straight from useArrayStatus()'s live
 * status.resync — the same data source ParityCheckCard/ArrayDisks already read for a parity
 * check or a new-disk clear (see that hook's own users) — this is a lightweight text/bar readout
 * of the same numbers, not a duplicate full progress card. 'committing'/'formatting' have no
 * percentage available yet, so those just show an indeterminate bar.
 */
export function DiskQueueCard() {
  const state = useDiskQueueStatus();
  const { status: arrayStatus } = useArrayStatus();
  const [busy, setBusy] = useState(false);

  if (!state || state.items.length === 0) return null;

  const running = state.items.find((i) => i.status === 'running');
  const queued = state.items.filter((i) => i.status === 'queued');
  const failed = state.items.find((i) => i.status === 'failed');
  const history = state.items.filter((i) => i.status === 'done');

  const resync = arrayStatus?.resync;

  const withBusy = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      // any failure here surfaces through the item's own state on the next poll
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="parity-card">
      <div className="parity-card__head">
        <div className="eyebrow">Disk Queue</div>
        {state.paused && (
          <button type="button" className="btn btn--danger" disabled={busy} onClick={() => withBusy(() => diskQueueApi.clear())}>
            Clear Queue
          </button>
        )}
      </div>

      {running && (
        <>
          <div className="status-note">
            {typeLabel(running.type)} — {running.label}: {phaseText(running.phase)}
          </div>
          {running.phase === 'awaiting-resync' && resync ? (
            <ResyncProgress resync={resync} />
          ) : (
            <ProgressBar color={COLORS.blue} height={8} indeterminate />
          )}
        </>
      )}

      {failed && (
        <div style={{ marginTop: running ? 'var(--space-md)' : 0 }}>
          <div className="status-note status-note--error">
            {typeLabel(failed.type)} — {failed.label} failed: {failed.error ?? 'unknown error'}
          </div>
          {failed.error === EXTERNAL_RESYNC_ERROR && resync?.active && (
            <div style={{ marginTop: 'var(--space-sm)' }}>
              <div className="status-note">Waiting on an external parity operation to finish — it'll resolve on its own.</div>
              <ResyncProgress resync={resync} />
            </div>
          )}
          <div className="dialog__actions">
            <button type="button" className="btn" disabled={busy} onClick={() => withBusy(() => diskQueueApi.remove(failed.id))}>
              Remove
            </button>
            <button type="button" className="btn--primary" disabled={busy} onClick={() => withBusy(() => diskQueueApi.retry(failed.id))}>
              Retry
            </button>
          </div>
        </div>
      )}

      {queued.length > 0 && (
        <div className="unassigned-devices" style={{ marginTop: 'var(--space-md)' }}>
          {queued.map((item) => (
            <div key={item.id} className="unassigned-device-row" style={{ cursor: 'default' }}>
              <div className="unassigned-device-row__info">
                <div className="unassigned-device-row__name">{typeLabel(item.type)}</div>
                <div className="unassigned-device-row__meta">{item.label} &middot; queued</div>
              </div>
              <button type="button" className="btn" disabled={busy} onClick={() => withBusy(() => diskQueueApi.remove(item.id))}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div style={{ marginTop: 'var(--space-md)' }}>
          <div className="eyebrow disk-section-label">Recently completed</div>
          <div className="unassigned-devices" style={{ marginTop: 6 }}>
            {history.map((item) => (
              <div key={item.id} className="unassigned-device-row" style={{ cursor: 'default', opacity: 0.6 }}>
                <div className="unassigned-device-row__info">
                  <div className="unassigned-device-row__name">{typeLabel(item.type)}</div>
                  <div className="unassigned-device-row__meta">{item.note ?? item.label}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
