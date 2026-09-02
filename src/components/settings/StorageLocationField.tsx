import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCacheStatus } from '../../hooks/useCacheStatus';
import { COLORS } from '../../styles/colors';
import type { StorageLocation, StoragePathProgress } from '../../types/storagePath';
import { PathAutocomplete } from '../shared/PathAutocomplete';
import { ProgressBar } from '../shared/ProgressBar';

interface CurrentLocation {
  mode: 'boot' | 'array' | 'cache' | 'custom';
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
type TargetMode = 'boot' | 'array' | 'cache' | 'custom';

const DISK_PREFIX = 'disk-';

function currentLabel(current: CurrentLocation | null, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!current) return '…';
  if (current.mode === 'boot') return t('StorageLocationField.bootDisk');
  if (current.mode === 'cache') return t('StorageLocationField.cache');
  if (current.mode === 'array') return t('StorageLocationField.diskSlot', { slot: current.diskSlot });
  return current.path; // 'custom' - a data-root this app didn't set, or one an admin typed directly
}

/** Shared by the Docker and LXC storage-location settings fields - same subsystem-picker + streamed
 *  migration-progress shape for both, just pointed at different API modules.
 *
 * "Custom path" (mode 'custom') is a free-text field rather than a pool picker with a fixed
 * subfolder appended underneath it - an earlier version of this picked a pool by name and always
 * landed on `<pool>/system/docker` (or `/system/lxc`), which silently doubled up for anyone whose
 * pool happened to be named "system" itself (`/mnt/user/system/system/lxc` - confirmed live).
 * Typing the exact target sidesteps that whole class of collision; PathAutocomplete's "binds" scope
 * still suggests real pool paths, so this loses none of the original picker's convenience. */
export function StorageLocationField({ title, desc, dataDisks, getStorage, moveStorage }: StorageLocationFieldProps) {
  const { t } = useTranslation('settings');
  const [current, setCurrent] = useState<CurrentLocation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [targetMode, setTargetMode] = useState<TargetMode>('boot');
  const [targetSlot, setTargetSlot] = useState<number | null>(null);
  const [targetCustomPath, setTargetCustomPath] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [messages, setMessages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const seeded = useRef(false);
  // A cache pool must actually be set up before "Cache" can be picked as a target - moving storage
  // onto a mirror that can never mount is worse than just not offering the option yet. Mirrors the
  // same gate ShareFormModal uses for its "Cache only" allocation option.
  const { status: cacheStatus } = useCacheStatus();
  const cacheConfigured = cacheStatus !== null && cacheStatus.health !== 'not-configured';

  useEffect(() => {
    getStorage()
      .then((info) => {
        setCurrent(info);
        if (!seeded.current) {
          setTargetMode(info.mode);
          setTargetSlot(info.diskSlot);
          if (info.mode === 'custom') setTargetCustomPath(info.path);
          seeded.current = true;
        }
      })
      .catch((err) => setLoadError((err as Error).message));
    // Only ever seeded once, on mount - re-running this on every getStorage identity change would
    // fight the user's own in-progress selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const targetUnchanged = current
    ? targetMode === current.mode &&
      (targetMode === 'boot' || targetMode === 'cache'
        ? true
        : targetMode === 'array'
          ? targetSlot === current.diskSlot
          : targetCustomPath.trim() === current.path)
    : false;

  const handleMove = async () => {
    setPhase('moving');
    setError(null);
    setMessages([]);
    try {
      const target: StorageLocation = {
        mode: targetMode,
        diskSlot: targetMode === 'array' ? targetSlot : null,
        customPath: targetMode === 'custom' ? targetCustomPath.trim() : null,
      };
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
        {desc} {t('StorageLocationField.currently')} <strong>{currentLabel(current, t)}</strong>
      </div>
      <div className="settings-field__row">
        <select
          className="history-input"
          disabled={phase === 'moving'}
          value={targetMode === 'array' ? `${DISK_PREFIX}${targetSlot}` : targetMode}
          onChange={(e) => {
            const value = e.target.value;
            if (value === 'boot' || value === 'cache' || value === 'custom') {
              setTargetMode(value);
              setTargetSlot(null);
            } else {
              setTargetMode('array');
              setTargetSlot(Number(value.slice(DISK_PREFIX.length)));
            }
          }}
        >
          <option value="boot">{t('StorageLocationField.bootDisk')}</option>
          <option value="cache" disabled={!cacheConfigured}>
            {cacheConfigured ? t('StorageLocationField.cache') : t('StorageLocationField.cacheNotSetUp')}
          </option>
          {dataDisks.map((d) => (
            <option key={d.slot} value={`${DISK_PREFIX}${d.slot}`}>
              {d.label}
            </option>
          ))}
          <option value="custom">{t('StorageLocationField.customPathOption')}</option>
        </select>
        {targetMode !== 'custom' && (
          <button
            type="button"
            className="btn"
            disabled={phase === 'moving' || targetUnchanged || (targetMode === 'array' && targetSlot === null)}
            onClick={handleMove}
          >
            {phase === 'moving' ? t('StorageLocationField.moving') : t('StorageLocationField.moveStorage')}
          </button>
        )}
      </div>
      {targetMode === 'custom' && (
        <div className="settings-field__row">
          <PathAutocomplete
            scope="binds"
            value={targetCustomPath}
            onChange={setTargetCustomPath}
            placeholder={t('StorageLocationField.customPathPlaceholder')}
            disabled={phase === 'moving'}
          />
          <button
            type="button"
            className="btn"
            disabled={phase === 'moving' || targetUnchanged || targetCustomPath.trim() === ''}
            onClick={handleMove}
          >
            {phase === 'moving' ? t('StorageLocationField.moving') : t('StorageLocationField.moveStorage')}
          </button>
        </div>
      )}
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
