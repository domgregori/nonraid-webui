import { useEffect, useRef, useState } from 'react';
import { COLORS } from '../../styles/colors';
import type { StorageLocation, StoragePathProgress } from '../../types/storagePath';
import { ProgressBar } from '../shared/ProgressBar';

interface CurrentLocation {
  mode: 'boot' | 'array' | 'custom';
  diskSlot: number | null;
  path: string;
}

interface StorageLocationFieldProps {
  title: string;
  desc: string;
  dataDisks: { slot: number; label: string }[];
  getStorage: () => Promise<CurrentLocation>;
  moveStorage: (target: StorageLocation, onProgress: (p: StoragePathProgress) => void) => Promise<{ path: string }>;
}

type Phase = 'idle' | 'moving';

function currentLabel(current: CurrentLocation | null): string {
  if (!current) return '…';
  if (current.mode === 'boot') return 'Boot Disk';
  if (current.mode === 'array') return `Disk ${current.diskSlot}`;
  return current.path; // 'custom' — a data-root this app didn't set
}

/** Shared by the Docker and LXC storage-location settings fields — same subsystem-picker + streamed
 *  migration-progress shape for both, just pointed at different API modules. */
export function StorageLocationField({ title, desc, dataDisks, getStorage, moveStorage }: StorageLocationFieldProps) {
  const [current, setCurrent] = useState<CurrentLocation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [targetMode, setTargetMode] = useState<'boot' | 'array'>('boot');
  const [targetSlot, setTargetSlot] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [messages, setMessages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const seeded = useRef(false);

  useEffect(() => {
    getStorage()
      .then((info) => {
        setCurrent(info);
        if (!seeded.current) {
          setTargetMode(info.mode === 'array' ? 'array' : 'boot');
          setTargetSlot(info.diskSlot);
          seeded.current = true;
        }
      })
      .catch((err) => setLoadError((err as Error).message));
    // Only ever seeded once, on mount — re-running this on every getStorage identity change would
    // fight the user's own in-progress selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const targetUnchanged = current
    ? targetMode === current.mode && (targetMode === 'boot' || targetSlot === current.diskSlot)
    : false;

  const handleMove = async () => {
    setPhase('moving');
    setError(null);
    setMessages([]);
    try {
      const target: StorageLocation = { mode: targetMode, diskSlot: targetMode === 'array' ? targetSlot : null };
      await moveStorage(target, (p) => setMessages((prev) => [...prev, p.message]));
      setCurrent(await getStorage());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPhase('idle');
    }
  };

  return (
    <div className="settings-field toggle-row--bordered">
      <div className="toggle-row__title">{title}</div>
      <div className="toggle-row__desc">
        {desc} Currently: <strong>{currentLabel(current)}</strong>
      </div>
      <div className="settings-field__row">
        <select
          className="history-input"
          disabled={phase === 'moving'}
          value={targetMode === 'boot' ? 'boot' : `disk-${targetSlot}`}
          onChange={(e) => {
            if (e.target.value === 'boot') {
              setTargetMode('boot');
              setTargetSlot(null);
            } else {
              setTargetMode('array');
              setTargetSlot(Number(e.target.value.replace('disk-', '')));
            }
          }}
        >
          <option value="boot">Boot Disk</option>
          {dataDisks.map((d) => (
            <option key={d.slot} value={`disk-${d.slot}`}>
              {d.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn"
          disabled={phase === 'moving' || targetUnchanged || (targetMode === 'array' && targetSlot === null)}
          onClick={handleMove}
        >
          {phase === 'moving' ? 'Moving…' : 'Move Storage'}
        </button>
      </div>
      {phase === 'moving' && <ProgressBar indeterminate color={COLORS.blue} height={6} />}
      {messages.length > 0 && (
        <div className="status-note">
          {messages.map((m, i) => (
            <div key={i}>{m}</div>
          ))}
        </div>
      )}
      {loadError && <div className="status-note status-note--error">{loadError}</div>}
      {error && <div className="status-note status-note--error">{error}</div>}
    </div>
  );
}
