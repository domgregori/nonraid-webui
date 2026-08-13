import { isArrayError } from '../../selectors/status';
import { useArrayStatus } from '../../state/useArrayStatus';
import { ReloadDriverPrompt } from '../shared/ReloadDriverPrompt';

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
 * gets the same two-step confirm rather than a single click (see
 * ReloadDriverPrompt, also used by ParityCheckCard for the same underlying
 * driver quirk surfacing as a stuck pending clear/recon instead).
 */
export function ArrayErrorBanner() {
  const { status } = useArrayStatus();

  if (!status || !isArrayError(status)) return null;

  return (
    <div className="status-note status-note--error" style={{ margin: '12px 16px 0' }}>
      <strong>Array error: {status.array.state}</strong> — {status.array.health.details || 'the array needs attention before it can start normally.'}
      <div style={{ marginTop: 8 }}>
        <ReloadDriverPrompt description="This reloads the storage driver to recover from stale internal counters — it doesn't change which disks are in the array, only refreshes its live state. Like any driver reload, it can leave the array briefly down if interrupted; let it finish once started." />
      </div>
    </div>
  );
}
