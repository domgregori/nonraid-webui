import { useState } from 'react';
import { cacheApi } from '../../api/cacheApi';
import { nmdApi } from '../../api/nmdApi';
import { useAvailableDevices } from '../../hooks/useAvailableDevices';
import { useArrayStatus } from '../../state/useArrayStatus';
import type { AvailableDevice } from '../../types/nmdApi';
import { formatBytesHuman } from '../../utils/format';
import { Card } from '../shared/Card';

type Role = 'unused' | 'parity1' | 'parity2' | 'data' | 'cacheA' | 'cacheB';

// nmdctl's own slot numbering (see backend/src/nmd/superblock.ts's MD_SB_P_IDX/MD_SB_Q_IDX):
// slot 0 is always Parity 1, slot 29 is always Parity 2, 1-28 are data.
const PARITY_SLOT = 0;
const PARITY2_SLOT = 29;

const ROLE_LABEL: Record<Role, string> = {
  unused: 'Not used',
  parity1: 'Parity 1',
  parity2: 'Parity 2',
  data: 'Data disk',
  cacheA: 'Cache (device 1)',
  cacheB: 'Cache (device 2)',
};

interface ArrayBuilderProps {
  /** Fired once the whole build sequence (parity, data disks, cache) has committed successfully. */
  onBuilt: () => void;
}

/**
 * Every pick here (Parity 1/2, one data disk, the two cache devices) is purely local state —
 * nothing is sent to nmdctl until "Build Array" runs the whole plan as one sequence. That's a
 * deliberate design choice, not a UI nicety: nmdctl's own `add` refuses outright once the array
 * has any uncommitted data disk (mdState flips to NEW_ARRAY — see tools/nmdctl's add_disk(), the
 * unconditional `[ "$mdstate" = "NEW_ARRAY" ]` check), so committing disks one at a time as the
 * user picks them (this component's predecessor) hits a wall the moment a second data disk is
 * added before the first one's been started.
 *
 * Data is capped at exactly one disk here, not looped like parity/cache — confirmed live that a
 * stop→add→start cycle for a *second* data disk doesn't actually work either: the `start` after
 * the first data disk only kicks off parity reconstruction as a pending background job, it doesn't
 * run it, and nmdctl hard-refuses (ERROR:INVALID_EXPANSION) to add another disk until that
 * reconstruction has actually completed — which can take minutes to hours on real disks, not
 * something to await synchronously inside one click. So this builds exactly the initial array
 * (parity + one data disk + optional cache) atomically; further data disks go through the Disks
 * page afterward the normal way, one at a time, each with its own real sync the Parity Check card
 * already shows progress for.
 */
export function ArrayBuilder({ onBuilt }: ArrayBuilderProps) {
  const { devices, status: devicesStatus, error: devicesError, refresh } = useAvailableDevices();
  const { status } = useArrayStatus();
  const [assignments, setAssignments] = useState<Record<string, Role>>({});
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [buildLog, setBuildLog] = useState<string[]>([]);

  const setRole = (device: string, role: Role) => {
    setAssignments((prev) => {
      const next = { ...prev };
      // Every role here — Parity 1/2, the one data disk, each cache slot — can only ever point at
      // one device; picking a role that's already held elsewhere moves it here instead of allowing
      // two devices to claim it.
      if (role !== 'unused') {
        for (const dev of Object.keys(next)) {
          if (next[dev] === role) delete next[dev];
        }
      }
      if (role === 'unused') delete next[device];
      else next[device] = role;
      return next;
    });
  };

  const byRole = (role: Role) => devices.filter((d) => assignments[d.device] === role);
  const parity1 = byRole('parity1')[0];
  const parity2 = byRole('parity2')[0];
  const dataDisks = byRole('data');
  const cacheA = byRole('cacheA')[0];
  const cacheB = byRole('cacheB')[0];
  const cachePartial = (!!cacheA) !== (!!cacheB);
  const hasAnyPlanned = !!parity1 || !!parity2 || dataDisks.length > 0 || (!!cacheA && !!cacheB);

  // An array needs at least one parity disk and one data disk — checked against whatever the
  // array already has committed (from an earlier build) plus whatever's newly planned here, so
  // reopening this step later just to add a second parity disk or a cache mirror still counts the
  // data disk(s) already committed, and vice versa, rather than demanding both roles every time.
  const existingHasParity = (status?.disks ?? []).some((d) => d.disk_id && (d.type === 'P' || d.type === 'Q'));
  const existingHasData = (status?.disks ?? []).some((d) => d.disk_id && d.type === 'data');
  const willHaveParity = existingHasParity || !!parity1 || !!parity2;
  const willHaveData = existingHasData || dataDisks.length > 0;
  const missingRequiredRole = !willHaveParity || !willHaveData;

  // nmdctl refuses to start (ERROR:PARITY_NOT_BIGGEST — confirmed live) once a data disk exceeds
  // parity's size, but only surfaces that at the very end of the build sequence, after several
  // disks are already committed. Catching it here, against both the disks just planned AND
  // whatever data disks the array already has from an earlier build, means the plan itself is
  // rejected up front instead of a mid-build failure half-committing the array.
  const biggestDataKb = Math.max(
    0,
    ...dataDisks.map((d) => d.sizeKb ?? 0),
    ...(status?.disks ?? []).filter((d) => d.disk_id && d.type === 'data').map((d) => d.size_kb),
  );
  const parityTooSmall = (device: AvailableDevice | undefined) => !!device && device.sizeKb != null && device.sizeKb < biggestDataKb;
  const parity1TooSmall = parityTooSmall(parity1);
  const parity2TooSmall = parityTooSmall(parity2);
  // Same check, but for parity the array already has committed from an earlier build — relevant
  // when this round only adds a bigger data disk without touching parity at all, so parity1/parity2
  // above (this round's *new* picks) wouldn't catch it.
  const existingParityKbs = (status?.disks ?? []).filter((d) => d.disk_id && (d.type === 'P' || d.type === 'Q')).map((d) => d.size_kb);
  const existingParityTooSmall = existingParityKbs.length > 0 && Math.min(...existingParityKbs) < biggestDataKb;

  // Any planned device nmdctl's own availability scan already flagged as locked/in-use — the add
  // itself would likely fail, so this is worth a heads-up before the whole sequence runs and stops
  // partway through. Not blocking (a false positive here shouldn't trap the user), just a warning.
  const plannedLocked = [parity1, parity2, ...dataDisks, cacheA, cacheB].filter((d): d is AvailableDevice => !!d && d.locked);

  const canBuild = hasAnyPlanned && !cachePartial && !parity1TooSmall && !parity2TooSmall && !existingParityTooSmall && !missingRequiredRole && !building;

  const appendLog = (line: string) => setBuildLog((prev) => [...prev, line]);

  const handleBuild = async () => {
    setBuilding(true);
    setBuildError(null);
    setBuildLog([]);
    try {
      const usedDataSlots = new Set((status?.disks ?? []).filter((d) => d.disk_id).map((d) => d.slot));
      let nextDataSlot = 1;
      const nextFreeSlot = () => {
        while (usedDataSlots.has(nextDataSlot)) nextDataSlot++;
        return nextDataSlot++;
      };

      const plan: { slot: number; device: AvailableDevice; role: 'parity' | 'data' }[] = [];
      if (parity1) plan.push({ slot: PARITY_SLOT, device: parity1, role: 'parity' });
      if (parity2) plan.push({ slot: PARITY2_SLOT, device: parity2, role: 'parity' });
      for (const d of dataDisks) plan.push({ slot: nextFreeSlot(), device: d, role: 'data' });

      for (const item of plan) {
        const live = await nmdApi.getStatus();
        if (live.array.state === 'STARTED') {
          appendLog('Stopping array to add the next disk…');
          await nmdApi.stopArray();
        }
        const label = item.role === 'parity' ? (item.slot === PARITY_SLOT ? 'Parity 1' : 'Parity 2') : `data disk (slot ${item.slot})`;
        appendLog(`Adding ${item.device.model ?? item.device.device} as ${label}…`);
        const res = await nmdApi.addDisk(item.slot, item.device.device, false);
        appendLog(res.output);
        if (item.role === 'data') {
          appendLog('Starting array…');
          await nmdApi.startArray();
          // start alone only marks the initial parity build pending (resync.pending) — it doesn't
          // run it. parityCheck('CORRECT') is the same action the dashboard's own Parity Check
          // card sends; RealNmdClient.parityCheck() already substitutes in the pending build's own
          // action word for this exact case (confirmed live: without this, parity sits at 0% and
          // DISK_INVALID indefinitely, and nmdctl later refuses to add another disk at all).
          appendLog('Starting initial parity build…');
          await nmdApi.parityCheck('CORRECT');
        }
      }

      if (cacheA && cacheB) {
        appendLog(`Setting up cache mirror (${cacheA.model ?? cacheA.device} + ${cacheB.model ?? cacheB.device})…`);
        const res = await cacheApi.setup(cacheA.device, cacheB.device);
        appendLog(res.message);
      }

      setAssignments({});
      refresh();
      onBuilt();
    } catch (err) {
      setBuildError((err as Error).message);
    } finally {
      setBuilding(false);
    }
  };

  return (
    <Card>
      <div className="disk-section-head">
        <div className="eyebrow disk-section-label">Unassigned Devices</div>
        <button type="button" className="disk-section-link disk-section-link--btn" onClick={refresh} disabled={building}>
          Refresh &#8635;
        </button>
      </div>

      {devicesStatus === 'loading' && <div className="status-note">Scanning for devices…</div>}
      {devicesError && <div className="status-note status-note--error">{devicesError}</div>}
      {devicesStatus === 'ready' && devices.length === 0 && <div className="status-note">No unassigned devices found.</div>}

      {devices.length > 0 && (
        <div className="unassigned-devices">
          {devices.map((d) => {
            const role = assignments[d.device] ?? 'unused';
            return (
              <div key={d.device} className="unassigned-device-row" style={{ cursor: 'default' }}>
                <div className="unassigned-device-row__info">
                  <div className="unassigned-device-row__name">{d.model ?? 'Unknown drive'}</div>
                  <div className="unassigned-device-row__meta">
                    {d.sizeKb != null ? formatBytesHuman(d.sizeKb * 1024) : 'unknown size'}
                    {d.isSSD !== null ? ` · ${d.isSSD ? 'SSD' : 'HDD'}` : ''}
                    {d.uuid ? '' : ' · no filesystem'}
                  </div>
                </div>
                <select
                  className="history-input"
                  value={role}
                  disabled={building}
                  onChange={(e) => setRole(d.device, e.target.value as Role)}
                >
                  {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                    <option key={r} value={r} disabled={r === 'data' && existingHasData}>
                      {r === 'data' && existingHasData ? 'Data disk (add from the Disks page)' : ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      )}

      <div className="onboarding-summary" style={{ marginTop: 'var(--space-lg)' }}>
        <div className="onboarding-summary__row">
          <span>Parity 1</span>
          <span>{parity1 ? (parity1.model ?? parity1.device) : 'not set'}</span>
        </div>
        <div className="onboarding-summary__row">
          <span>Parity 2</span>
          <span>{parity2 ? (parity2.model ?? parity2.device) : 'none'}</span>
        </div>
        <div className="onboarding-summary__row">
          <span>Data disk</span>
          <span>{dataDisks.length > 0 ? dataDisks.map((d) => d.model ?? d.device).join(', ') : existingHasData ? 'already set' : 'not set'}</span>
        </div>
        <div className="onboarding-summary__row">
          <span>Cache mirror</span>
          <span>{cacheA && cacheB ? `${cacheA.model ?? cacheA.device} + ${cacheB.model ?? cacheB.device}` : 'not set'}</span>
        </div>
      </div>

      {cachePartial && <div className="status-note status-note--error">Cache needs both devices picked — or neither.</div>}
      {hasAnyPlanned && missingRequiredRole && (
        <div className="status-note status-note--error">
          {!willHaveParity && !willHaveData
            ? 'Pick at least one parity disk and one data disk.'
            : !willHaveParity
              ? 'Pick at least one parity disk.'
              : 'Pick at least one data disk.'}
        </div>
      )}
      {(parity1TooSmall || parity2TooSmall) && (
        <div className="status-note status-note--error">
          {parity1TooSmall && parity2TooSmall ? 'Parity 1 and Parity 2 are' : parity1TooSmall ? 'Parity 1 is' : 'Parity 2 is'} smaller than
          your biggest data disk ({formatBytesHuman(biggestDataKb * 1024)}) — pick a bigger disk, or a smaller data disk.
        </div>
      )}
      {!parity1TooSmall && !parity2TooSmall && existingParityTooSmall && (
        <div className="status-note status-note--error">
          Your existing parity disk is smaller than this new data disk ({formatBytesHuman(biggestDataKb * 1024)}) — replace parity with a
          bigger disk first, or pick a smaller data disk.
        </div>
      )}
      {plannedLocked.length > 0 && (
        <div className="status-note status-note--error">
          {plannedLocked.map((d) => d.model ?? d.device).join(', ')} appear{plannedLocked.length === 1 ? 's' : ''} to be locked/in use by
          another process — building may fail.
        </div>
      )}
      {status?.array.state === 'STARTED' && hasAnyPlanned && (
        <div className="status-note">The array is currently running — building this plan will stop and restart it.</div>
      )}
      {buildError && <div className="status-note status-note--error">{buildError}</div>}

      {buildLog.length > 0 && <pre className="import-raw-output">{buildLog.join('\n\n')}</pre>}

      <div className="onboarding__actions" style={{ marginTop: 'var(--space-lg)' }}>
        <div className="onboarding__actions-right">
          <button type="button" className="btn btn--primary" disabled={!canBuild} onClick={handleBuild}>
            {building ? 'Building array…' : 'Build Array'}
          </button>
        </div>
      </div>
    </Card>
  );
}
