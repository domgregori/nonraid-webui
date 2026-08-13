import { useState } from 'react';
import { nmdApi } from '../../api/nmdApi';

interface ReloadDriverPromptProps {
  /** Context-specific explanation of why *this* card is offering a reload - the confirm step's
   *  own risk/behavior text (stop-containers checkbox, "doesn't change array config") stays fixed. */
  description: string;
  onReloaded?: () => void;
}

/** Two-step "Reload Driver" control for stale driver-side counters - counters that accumulate
 *  across import calls within one loaded module session (num_new, num_invalid, etc. in
 *  md_unraid.c's status_resync()) and are only ever reset by a fresh module load, not a plain
 *  stop/start. Shared by ArrayErrorBanner (an ERROR:* array state) and ParityCheckCard (a
 *  clear/recon stuck pending with no real disk behind it) - same underlying driver quirk, two
 *  different symptoms.
 */
export function ReloadDriverPrompt({ description, onReloaded }: ReloadDriverPromptProps) {
  const [confirming, setConfirming] = useState(false);
  const [stopContainers, setStopContainers] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReload = async () => {
    setRunning(true);
    setError(null);
    try {
      await nmdApi.reloadDriver(stopContainers);
      setConfirming(false);
      onReloaded?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  };

  if (!confirming) {
    return (
      <button type="button" className="btn btn--danger" onClick={() => setConfirming(true)}>
        Reload Driver
      </button>
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      <p style={{ margin: '0 0 8px' }}>{description}</p>
      <label style={{ display: 'block', marginBottom: 8 }}>
        <input type="checkbox" checked={stopContainers} onChange={(e) => setStopContainers(e.target.checked)} disabled={running} />{' '}
        Stop Docker and running LXC containers first, if needed (e.g. a container's storage is on an array disk and
        blocking the reload) - they're started again automatically right after.
      </label>
      {error && <div style={{ marginBottom: 8 }}>{error}</div>}
      <button type="button" className="btn" disabled={running} onClick={() => setConfirming(false)}>
        Cancel
      </button>{' '}
      <button type="button" className="btn btn--danger" disabled={running} onClick={handleReload}>
        {running ? 'Reloading…' : 'Confirm Reload'}
      </button>
    </div>
  );
}
