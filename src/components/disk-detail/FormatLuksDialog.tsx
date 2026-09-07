import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { luksApi } from '../../api/luksApi';
import { StepUpModal } from '../shared/StepUpModal';

interface FormatLuksDialogProps {
  slot: number;
  label: string;
  onClose: () => void;
  onDone: () => void;
}

const MIN_PASSPHRASE_LENGTH = 8;

/**
 * Guided "new/blank disk -> LUKS" setup (docs/luks-support-scope.md's only v1 wizard path -
 * converting an *existing* disk's data to LUKS is deliberately not offered here, see that doc for
 * why). Two steps: collect and confirm the disk's own passphrase, then the account step-up
 * re-auth (StepUpModal, same component SSH key management uses) actually submits it - mirroring
 * SshKeysSection's own "collect draft, then StepUpModal submits it" composition, since this
 * mutation is just as sensitive (it mints a brand-new secret) as adding a trusted SSH key. The
 * server always generates a second, human-memorable recovery passphrase (see
 * backend/src/luks/recoveryPassphrase.ts) - shown here exactly once, with an explicit
 * acknowledgement required before the dialog can be closed, since losing it (with no other key
 * remembered) is unrecoverable data loss.
 */
export function FormatLuksDialog({ slot, label, onClose, onDone }: FormatLuksDialogProps) {
  const { t } = useTranslation('diskDetail');
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [confirmingStepUp, setConfirmingStepUp] = useState(false);
  const [recoveryPassphrase, setRecoveryPassphrase] = useState<string | null>(null);
  const [savedAcknowledged, setSavedAcknowledged] = useState(false);

  const passphraseTooShort = passphrase.length > 0 && passphrase.length < MIN_PASSPHRASE_LENGTH;
  const mismatch = confirmPassphrase.length > 0 && passphrase !== confirmPassphrase;
  const canContinue = passphrase.length >= MIN_PASSPHRASE_LENGTH && passphrase === confirmPassphrase;

  return (
    <>
      <div className="detail-overlay" onClick={() => !recoveryPassphrase && onClose()} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">{t('FormatLuksDialog.title', { label })}</div>
          {!recoveryPassphrase && (
            <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('FormatLuksDialog.close')}>
              &#10005;
            </button>
          )}
        </div>

        <div className="dialog__body">
          {!recoveryPassphrase && (
            <>
              <div className="status-note">{t('FormatLuksDialog.intro')}</div>
              <div className="status-note status-note--error">{t('FormatLuksDialog.dataWarning')}</div>

              <div className="settings-field">
                <div className="toggle-row__title">{t('FormatLuksDialog.passphrase')}</div>
                <input
                  type="password"
                  className="history-input"
                  style={{ width: '100%' }}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder={t('FormatLuksDialog.passphrasePlaceholder')}
                  autoFocus
                />
                {passphraseTooShort && <div className="status-note status-note--error">{t('FormatLuksDialog.tooShort', { min: MIN_PASSPHRASE_LENGTH })}</div>}
              </div>

              <div className="settings-field">
                <div className="toggle-row__title">{t('FormatLuksDialog.confirmPassphrase')}</div>
                <input
                  type="password"
                  className="history-input"
                  style={{ width: '100%' }}
                  value={confirmPassphrase}
                  onChange={(e) => setConfirmPassphrase(e.target.value)}
                  placeholder={t('FormatLuksDialog.confirmPassphrasePlaceholder')}
                />
                {mismatch && <div className="status-note status-note--error">{t('FormatLuksDialog.mismatch')}</div>}
              </div>

              <div className="status-note">{t('FormatLuksDialog.recoveryNote')}</div>

              <div className="dialog__actions">
                <button type="button" className="btn" onClick={onClose}>
                  {t('FormatLuksDialog.cancel')}
                </button>
                <button type="button" className="btn--primary" disabled={!canContinue} onClick={() => setConfirmingStepUp(true)}>
                  {t('FormatLuksDialog.continue')}
                </button>
              </div>
            </>
          )}

          {recoveryPassphrase && (
            <>
              <div className="status-note status-note--error">{t('FormatLuksDialog.recoveryWarning')}</div>
              <div className="luks-recovery-passphrase">{recoveryPassphrase}</div>
              <label className="toggle-row" style={{ marginTop: 12 }}>
                <input type="checkbox" checked={savedAcknowledged} onChange={(e) => setSavedAcknowledged(e.target.checked)} />
                <span className="toggle-row__title">{t('FormatLuksDialog.savedAcknowledge')}</span>
              </label>
              <div className="dialog__actions">
                <button
                  type="button"
                  className="btn--primary"
                  disabled={!savedAcknowledged}
                  onClick={() => {
                    onDone();
                    onClose();
                  }}
                >
                  {t('FormatLuksDialog.done')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {confirmingStepUp && (
        <StepUpModal
          title={t('FormatLuksDialog.confirmItsYou')}
          description={t('FormatLuksDialog.stepUpDesc')}
          confirmLabel={t('FormatLuksDialog.formatButton')}
          onClose={() => setConfirmingStepUp(false)}
          onConfirm={async (password, totpCode) => {
            const result = await luksApi.formatAsLuks(slot, passphrase, password, totpCode);
            setRecoveryPassphrase(result.recoveryPassphrase);
          }}
        />
      )}
    </>
  );
}
