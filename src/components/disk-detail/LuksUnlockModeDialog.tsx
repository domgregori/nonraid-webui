import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { luksApi } from '../../api/luksApi';
import { StepUpModal } from '../shared/StepUpModal';
import type { LuksUnlockMode } from '../../types/luksApi';

interface LuksUnlockModeDialogProps {
  currentMode: LuksUnlockMode;
  onClose: () => void;
  onDone: () => void;
}

const MIN_PASSPHRASE_LENGTH = 8;

/**
 * Switches every currently-unlocked encrypted disk between the two unlock modes
 * (docs/luks-support-scope.md's "Switching modes is a real operation" section) - a real LUKS
 * key-slot change on each disk (luksAddKey/luksAddKeyfile + luksRemoveKey server-side), not a
 * settings toggle, so this is its own guided flow with its own step-up confirmation rather than a
 * boolean flip somewhere in Settings. Both directions need one currently-unlockable secret typed
 * in: switching to stored needs an existing passphrase (to authorize adding the keyfile), switching
 * to manual needs a brand-new passphrase (added while the keyfile itself is still what's
 * authorizing the disk). If different disks were formatted with different passphrases, only the
 * ones the entered passphrase actually matches get updated - see LuksSection's own note about this.
 */
export function LuksUnlockModeDialog({ currentMode, onClose, onDone }: LuksUnlockModeDialogProps) {
  const { t } = useTranslation('diskDetail');
  const [passphrase, setPassphrase] = useState('');
  const [confirmingStepUp, setConfirmingStepUp] = useState(false);
  const [result, setResult] = useState<{ disksUpdated: number; skippedLocked: number } | null>(null);
  const targetMode: LuksUnlockMode = currentMode === 'manual' ? 'stored' : 'manual';
  const canContinue = targetMode === 'stored' ? passphrase.length > 0 : passphrase.length >= MIN_PASSPHRASE_LENGTH;

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">
            {targetMode === 'stored' ? t('LuksUnlockModeDialog.titleToStored') : t('LuksUnlockModeDialog.titleToManual')}
          </div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('LuksUnlockModeDialog.close')}>
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          {!result && (
            <>
              <div className="status-note">
                {targetMode === 'stored' ? t('LuksUnlockModeDialog.introToStored') : t('LuksUnlockModeDialog.introToManual')}
              </div>
              <div className="status-note status-note--error">
                {targetMode === 'stored' ? t('LuksUnlockModeDialog.storedWarning') : t('LuksUnlockModeDialog.manualWarning')}
              </div>

              <div className="settings-field">
                <div className="toggle-row__title">
                  {targetMode === 'stored' ? t('LuksUnlockModeDialog.existingPassphrase') : t('LuksUnlockModeDialog.newPassphrase')}
                </div>
                <input
                  type="password"
                  className="history-input"
                  style={{ width: '100%' }}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  autoFocus
                />
                {targetMode === 'stored' && (
                  <div className="toggle-row__desc" style={{ marginTop: 6 }}>
                    {t('LuksUnlockModeDialog.multiplePassphrasesNote')}
                  </div>
                )}
              </div>

              <div className="dialog__actions">
                <button type="button" className="btn" onClick={onClose}>
                  {t('LuksUnlockModeDialog.cancel')}
                </button>
                <button type="button" className="btn--primary" disabled={!canContinue} onClick={() => setConfirmingStepUp(true)}>
                  {t('LuksUnlockModeDialog.continue')}
                </button>
              </div>
            </>
          )}

          {result && (
            <>
              <div className="status-note">{t('LuksUnlockModeDialog.resultSummary', { count: result.disksUpdated })}</div>
              {result.skippedLocked > 0 && (
                <div className="status-note status-note--error">{t('LuksUnlockModeDialog.skippedLockedNote', { count: result.skippedLocked })}</div>
              )}
              <div className="dialog__actions">
                <button
                  type="button"
                  className="btn--primary"
                  onClick={() => {
                    onDone();
                    onClose();
                  }}
                >
                  {t('LuksUnlockModeDialog.done')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {confirmingStepUp && (
        <StepUpModal
          title={t('LuksUnlockModeDialog.confirmItsYou')}
          description={t('LuksUnlockModeDialog.stepUpDesc')}
          onClose={() => setConfirmingStepUp(false)}
          onConfirm={async (password, totpCode) => {
            const res =
              targetMode === 'stored' ? await luksApi.switchToStored(passphrase, password, totpCode) : await luksApi.switchToManual(passphrase, password, totpCode);
            setResult({ disksUpdated: res.disksUpdated, skippedLocked: res.skippedLocked });
          }}
        />
      )}
    </>
  );
}
