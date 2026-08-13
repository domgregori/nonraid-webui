import { isArrayError } from '../../selectors/status';
import { useArrayStatus } from '../../state/useArrayStatus';
import { COLORS } from '../../styles/colors';
import { ReloadDriverPrompt } from '../shared/ReloadDriverPrompt';
import { Card } from '../shared/Card';

/**
 * Dashboard-only card for an ERROR:* array state — confirmed against the kernel driver source
 * this session, this means something actually needs a look (TOO_MANY_MISSING_DISKS and similar),
 * not just a normal stopped/degraded array. Was a global, page-independent banner
 * (ArrayErrorBanner) until the notification system took over "make sure this is seen wherever
 * you are" (a red toast + bell entry, from ActivityWatcher's checkArrayError) — the actual
 * recovery action stays here instead, alongside every other array-recovery control on this page.
 *
 * Most of the time this state clears on its own with a normal explicit start once whatever caused
 * it is resolved. Reload Driver is for the specific case where it doesn't: stale driver-side
 * counters that accumulate across import calls within one module session and are only ever
 * recomputed by a fresh module load — reloading re-imports every disk's already-known identity
 * fresh, without changing the array's configuration. Same risk category as Shrink Array's module
 * reload, so it gets the same two-step confirm rather than a single click (see ReloadDriverPrompt,
 * also used by ParityCheckCard for the same underlying driver quirk surfacing as a stuck pending
 * clear/recon instead).
 */
export function ArrayErrorCard() {
  const { status } = useArrayStatus();

  if (!status || !isArrayError(status)) return null;

  return (
    <Card className="parity-card">
      <div className="parity-card__head">
        <div className="eyebrow" style={{ color: COLORS.red }}>
          Array Error
        </div>
      </div>
      <div className="status-note status-note--error">
        <strong>{status.array.state}</strong> — {status.array.health.details || 'the array needs attention before it can start normally.'}
      </div>
      <ReloadDriverPrompt description="This reloads the storage driver to recover from stale internal counters — it doesn't change which disks are in the array, only refreshes its live state. Like any driver reload, it can leave the array briefly down if interrupted; let it finish once started." />
    </Card>
  );
}
