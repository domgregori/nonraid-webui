import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sshApi } from '../../api/sshApi';
import type { SshKeyEntry } from '../../types/sshApi';
import { StepUpModal } from '../shared/StepUpModal';

/** Same swatch tints RemoteBackupSection.tsx/AppriseTargetsField.tsx already reuse for their own
 *  list rows - a stable hash across the same three colors rather than a new one just for this. */
const SWATCH_COLORS = ['b2', 'gdrive', 'sftp'] as const;
function swatchClass(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return `provider-swatch--${SWATCH_COLORS[hash % SWATCH_COLORS.length]}`;
}

/** Trusted SSH public keys (root's authorized_keys) - a minimal add/list/remove manager, same
 *  "add" and "list with per-row remove" shape as AppriseTargetsField.tsx's target list. Both add
 *  and remove pop the shared StepUpModal (backed by requireStepUp on the /ssh/keys routes) -
 *  removing the wrong key is just as much an access-control change as adding a rogue one, unlike
 *  RemovePasskeyDialog.tsx's no-re-auth treatment for passkeys (one of several 2FA factors).
 *  Remove also gets the same click-once-to-arm "Confirm?" relabel BrowsePage.tsx's own Delete
 *  button uses, on top of the step-up modal - two distinct guards for a mis-click vs. someone
 *  else at an unlocked, already-logged-in session. */
export function SshKeysSection() {
  const { t } = useTranslation('settings');
  const [keys, setKeys] = useState<SshKeyEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmingAdd, setConfirmingAdd] = useState(false);
  const [armedFingerprint, setArmedFingerprint] = useState<string | null>(null);
  const [confirmingRemoveFingerprint, setConfirmingRemoveFingerprint] = useState<string | null>(null);

  useEffect(() => {
    sshApi
      .getStatus()
      .then((s) => setKeys(s.keys))
      .catch((err) => setLoadError((err as Error).message));
  }, []);

  const handleRemoveClick = (fingerprint: string) => {
    if (armedFingerprint === fingerprint) {
      setArmedFingerprint(null);
      setConfirmingRemoveFingerprint(fingerprint);
    } else {
      setArmedFingerprint(fingerprint);
    }
  };

  return (
    <div className="settings-field">
      <div className="toggle-row__title">{t('SshKeysSection.title')}</div>
      <div className="toggle-row__desc">{t('SshKeysSection.desc')}</div>

      {loadError && <div className="status-note status-note--error">{loadError}</div>}

      {keys && keys.length > 0 && (
        <div className="remote-list">
          {keys.map((k) => (
            <div className="remote-row" key={k.fingerprint}>
              <div className={`remote-row__icon ${swatchClass(k.type)}`}>{k.type.replace('ssh-', '').slice(0, 2).toUpperCase()}</div>
              <div className="remote-row__body">
                <div className="remote-row__name">{k.comment || k.type}</div>
                <div className="remote-row__meta">
                  {k.type} …{k.fingerprint}
                </div>
              </div>
              <div className="remote-row__actions">
                <button type="button" className="btn btn--danger" onClick={() => handleRemoveClick(k.fingerprint)}>
                  {armedFingerprint === k.fingerprint ? t('SshKeysSection.confirm') : t('SshKeysSection.remove')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {keys && keys.length === 0 && <div className="status-note">{t('SshKeysSection.noKeys')}</div>}

      <textarea
        className="history-input settings-textarea"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="ssh-ed25519 AAAA... user@laptop"
        rows={2}
      />
      <div className="settings-field__row">
        <button type="button" className="btn" disabled={!draft.trim()} onClick={() => setConfirmingAdd(true)}>
          {t('SshKeysSection.addKey')}
        </button>
      </div>

      {confirmingAdd && (
        <StepUpModal
          title={t('SshKeysSection.confirmItsYou')}
          description={t('SshKeysSection.addKeyDesc')}
          confirmLabel={t('SshKeysSection.addKey')}
          onClose={() => setConfirmingAdd(false)}
          onConfirm={async (password, totpCode) => {
            const result = await sshApi.addKey(draft, password, totpCode);
            setKeys(result.keys);
            setDraft('');
          }}
        />
      )}

      {confirmingRemoveFingerprint && (
        <StepUpModal
          title={t('SshKeysSection.confirmItsYou')}
          description={t('SshKeysSection.removeKeyDesc')}
          confirmLabel={t('SshKeysSection.removeKey')}
          onClose={() => setConfirmingRemoveFingerprint(null)}
          onConfirm={async (password, totpCode) => {
            const result = await sshApi.removeKey(confirmingRemoveFingerprint, password, totpCode);
            setKeys(result.keys);
          }}
        />
      )}
    </div>
  );
}
