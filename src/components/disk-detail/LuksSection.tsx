import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { luksApi } from '../../api/luksApi';
import { useSettings } from '../../hooks/useSettings';
import { useUnlockDisk } from '../../hooks/useUnlockDisk';
import { COLORS } from '../../styles/colors';
import { LuksUnlockModeDialog } from './LuksUnlockModeDialog';
import type { DiskViewModel } from '../../types';
import type { LuksUnlockMode } from '../../types/luksApi';

interface LuksSectionProps {
  disk: DiskViewModel;
  onChanged: () => void;
}

/**
 * Per-disk encryption status/controls, shown on an already-LUKS-formatted disk (the "new disk ->
 * LUKS" format choice itself lives in DiskDetailPanel's own needsFormat block, not here - see
 * FormatLuksDialog). Lock/unlock aren't step-up gated (see routes/luks.ts's own reasoning);
 * "Change unlock method" is, since it re-keys every disk at once.
 */
export function LuksSection({ disk, onChanged }: LuksSectionProps) {
  const { t } = useTranslation('diskDetail');
  const { settings } = useSettings();
  // Seeded from the settings context (already fetched once app-wide) rather than this
  // component's own GET /luks/status call - that separate fetch used to fire on every
  // disk-detail view, encrypted or not, purely to learn a value /settings already carries (see
  // settings/types.ts's LuksSettings). Kept as local state rather than read directly off
  // `settings` on every render because switchToStored/switchToManual's own success below needs to
  // flip it immediately - `settings` itself is a fetch-once snapshot with no refetch after a
  // mode-switch mutation, so nothing else would pick up the change until a full page reload.
  const [unlockMode, setUnlockMode] = useState<LuksUnlockMode | null>(settings?.luks?.unlockMode ?? null);

  useEffect(() => {
    if (settings?.luks) setUnlockMode(settings.luks.unlockMode);
  }, [settings]);

  const [showModeDialog, setShowModeDialog] = useState(false);

  const [lockPending, setLockPending] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  // Shared with the dashboard's own per-disk unlock modal (DiskCard's lock icon) - see
  // hooks/useUnlockDisk.ts's own doc comment for why this isn't duplicated inline here anymore.
  const { passphrase, setPassphrase, pending: unlockPending, error: unlockError, unlock: handleUnlock } = useUnlockDisk(disk.slot, onChanged);

  if (disk.encryption === 'none') return null;

  const handleLock = async () => {
    setLockPending(true);
    setLockError(null);
    try {
      await luksApi.lock(disk.slot);
      onChanged();
    } catch (err) {
      setLockError((err as Error).message);
    } finally {
      setLockPending(false);
    }
  };

  return (
    <div className="detail-card">
      <div className="eyebrow">{t('LuksSection.title')}</div>
      <div className="detail-row">
        <span className="detail-row__label">{t('DiskDetailPanel.info')}</span>
        <span className="detail-row__value" style={{ color: disk.encryption === 'luks-locked' ? COLORS.red : COLORS.green }}>
          {disk.encryption === 'luks-locked' ? t('LuksSection.statusLocked') : t('LuksSection.statusOpen')}
        </span>
      </div>

      {disk.encryption === 'luks-locked' && (
        <div className="settings-field__row" style={{ marginTop: 8 }}>
          <input
            type="password"
            className="history-input"
            placeholder={t('LuksSection.unlockPlaceholder')}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
            disabled={unlockPending}
          />
          <button type="button" className="btn" disabled={unlockPending || !passphrase} onClick={handleUnlock}>
            {unlockPending ? t('LuksSection.unlocking') : t('LuksSection.unlock')}
          </button>
        </div>
      )}

      {disk.encryption === 'luks-open' && (
        <div className="detail-actions" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn--block" disabled={lockPending} onClick={handleLock}>
            {lockPending ? t('LuksSection.locking') : t('LuksSection.lock')}
          </button>
          {unlockMode && (
            <button type="button" className="btn btn--block" onClick={() => setShowModeDialog(true)}>
              {t('LuksSection.changeUnlockMethod')}
            </button>
          )}
        </div>
      )}

      {(unlockError || lockError) && <div className="status-note status-note--error">{unlockError || lockError}</div>}

      {showModeDialog && unlockMode && (
        <LuksUnlockModeDialog
          currentMode={unlockMode}
          onClose={() => setShowModeDialog(false)}
          onDone={() => {
            setUnlockMode((m) => (m === 'stored' ? 'manual' : 'stored'));
            onChanged();
          }}
        />
      )}
    </div>
  );
}
