import { useState } from 'react';
import { nmdApi } from '../../api/nmdApi';
import { isArrayError } from '../../selectors/status';
import { useArrayStatus } from '../../state/useArrayStatus';

/**
 * Global, page-independent banner for an ERROR:* array state — confirmed
 * against the kernel driver source this session, this means something
 * actually needs a look (TOO_MANY_MISSING_DISKS and similar), not just a
 * normal stopped/degraded array. Before this existed, the dashboard showed
 * this identically to a plain intentional stop — a real gap found while
 * building the recovery action below, since it's exactly what made an
 * earlier stale-counter incident this session only visible via raw API/SSH
 * checks, never the UI itself.
 *
 * Most of the time this state clears on its own with a normal explicit
 * start once whatever caused it is resolved. Reload Driver is for the
 * specific case where it doesn't: stale driver-side counters that
 * accumulate across import calls within one module session and are only
 * ever recomputed by a fresh module load — reloading re-imports every
 * disk's already-known identity fresh, without changing the array's
 * configuration. Same risk category as Shrink Array's module reload, so it
 * gets the same two-step confirm rather than a single click.
 */
export function ArrayErrorBanner() {
  const { status } = useArrayStatus();
  const [confirming, setConfirming] = useState(false);
  const [stopContainers, setStopContainers] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!status || !isArrayError(status)) return null;

  const handleReload = async () => {
    setRunning(true);
    setError(null);
    try {
      await nmdApi.reloadDriver(stopContainers);
      setConfirming(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="status-note status-note--error" style={{ margin: '12px 16px 0' }}>
      <strong>Array error: {status.array.state}</strong> — {status.array.health.details || 'the array needs attention before it can start normally.'}
      {!confirming ? (
        <div style={{ marginTop: 8 }}>
          <button type="button" className="btn btn--danger" onClick={() => setConfirming(true)}>
            Reload Driver
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <p style={{ margin: '0 0 8px' }}>
            This reloads the storage driver to recover from stale internal counters — it doesn't change which disks
            are in the array, only refreshes its live state. Like any driver reload, it can leave the array briefly
            down if interrupted; let it finish once started.
          </p>
          <label style={{ display: 'block', marginBottom: 8 }}>
            <input type="checkbox" checked={stopContainers} onChange={(e) => setStopContainers(e.target.checked)} disabled={running} />{' '}
            Stop Docker and running LXC containers first, if needed (e.g. a container's storage is on an array
            disk and blocking the reload) — they're started again automatically right after.
          </label>
          {error && <div style={{ marginBottom: 8 }}>{error}</div>}
          <button type="button" className="btn" disabled={running} onClick={() => setConfirming(false)}>
            Cancel
          </button>{' '}
          <button type="button" className="btn btn--danger" disabled={running} onClick={handleReload}>
            {running ? 'Reloading…' : 'Confirm Reload'}
          </button>
        </div>
      )}
    </div>
  );
}
