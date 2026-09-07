import { useTranslation } from 'react-i18next';
import { useUnlockDisk } from '../../hooks/useUnlockDisk';

interface UnlockDiskModalProps {
  slot: number;
  label: string;
  onClose: () => void;
  onUnlocked: () => void;
}

/**
 * Dashboard-level "unlock this disk" modal - opened by clicking the lock icon on a locked disk's
 * DiskCard (see DiskCard.tsx's EncryptionIcon), so a locked disk can be unlocked right from the
 * dashboard without drilling into its detail panel first. Same luksApi.unlock() call
 * disk-detail/LuksSection.tsx's own unlock control uses, via the shared useUnlockDisk() hook, so
 * this doesn't duplicate that pending/error bookkeeping a third time. Not step-up gated, same
 * reasoning as LuksSection's own unlock control (routes/luks.ts) - unlocking uses an already-known
 * secret, it doesn't mint one.
 */
export function UnlockDiskModal({ slot, label, onClose, onUnlocked }: UnlockDiskModalProps) {
  const { t } = useTranslation('dashboard');
  const { passphrase, setPassphrase, pending, error, unlock } = useUnlockDisk(slot, () => {
    onUnlocked();
    onClose();
  });

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">{t('UnlockDiskModal.title', { label })}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('UnlockDiskModal.close')}>
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          <input
            type="password"
            className="history-input"
            style={{ width: '100%' }}
            placeholder={t('UnlockDiskModal.passphrasePlaceholder')}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && unlock()}
            disabled={pending}
            autoFocus
          />
          {error && <div className="status-note status-note--error">{error}</div>}

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onClose}>
              {t('UnlockDiskModal.cancel')}
            </button>
            <button type="button" className="btn--primary" disabled={pending || !passphrase} onClick={unlock}>
              {pending ? t('UnlockDiskModal.unlocking') : t('UnlockDiskModal.unlock')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
