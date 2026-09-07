import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUnlockAllDisks } from '../../hooks/useUnlockAllDisks';
import type { DiskViewModel } from '../../types';

interface UnlockAllDialogProps {
  disks: DiskViewModel[];
  onClose: () => void;
  onDone: () => void;
}

/**
 * Disks page - "Unlock All" primary entry point for every currently-locked disk at once, with one
 * shared secret: either a typed passphrase, or an uploaded keyfile (matching how `cryptsetup
 * luksOpen --key-file` itself genuinely accepts either a typed secret or a file's raw contents as
 * key material). The keyfile's bytes never touch disk anywhere in this path - luksApi.unlock()
 * base64-encodes them client-side and sends them as one JSON field; the backend decodes straight
 * into a Buffer and pipes it to cryptsetup over stdin (`--key-file -`), the same stdin-piping
 * mechanism a typed passphrase already uses (see backend/src/luks/cryptsetup.ts's luksOpen()) -
 * never a temp path.
 *
 * This is the one and only "Unlock All" implementation - a dashboard-level passphrase-only
 * shortcut (LuksLockedCard) existed briefly during development but was removed once this became
 * the primary entry point, rather than leaving two diverging code paths around. Every locked-disk
 * indicator elsewhere (the header's DEGRADED pill/dialog, DiskCard's own lock icon) points here or
 * at this same disk's own detail page, not at a second "Unlock All" surface.
 */
export function UnlockAllDialog({ disks, onClose, onDone }: UnlockAllDialogProps) {
  const { t } = useTranslation('diskDetail');
  const [mode, setMode] = useState<'passphrase' | 'keyfile'>('passphrase');
  const [passphrase, setPassphrase] = useState('');
  const [keyfile, setKeyfile] = useState<File | null>(null);
  const { pending, results, unlockAll } = useUnlockAllDisks(onDone);

  const canSubmit = mode === 'passphrase' ? passphrase.length > 0 : keyfile !== null;
  const submit = () => {
    if (!canSubmit) return;
    unlockAll(
      disks.map((d) => d.slot),
      mode === 'passphrase' ? { passphrase } : { keyfile: keyfile! },
    );
  };

  const resultFor = (slot: number) => results?.find((r) => r.slot === slot);
  const allSucceeded = results !== null && results.every((r) => r.ok);

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">{t('UnlockAllDialog.title', { count: disks.length })}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('UnlockAllDialog.close')}>
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          <div className="status-note">{t('UnlockAllDialog.desc')}</div>

          <div className="luks-locked-list" style={{ marginBottom: 12 }}>
            {disks.map((disk) => (
              <div key={disk.slot} className="luks-locked-row">
                <div className="luks-locked-row__label">{disk.customLabel ?? disk.label}</div>
                {resultFor(disk.slot) && (
                  <span className={resultFor(disk.slot)!.ok ? 'status-note' : 'status-note status-note--error'}>
                    {resultFor(disk.slot)!.ok ? t('UnlockAllDialog.unlockedOne') : resultFor(disk.slot)!.error}
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="settings-field__row">
            <button type="button" className={mode === 'passphrase' ? 'btn btn--primary' : 'btn'} onClick={() => setMode('passphrase')} disabled={pending}>
              {t('UnlockAllDialog.passphraseTab')}
            </button>
            <button type="button" className={mode === 'keyfile' ? 'btn btn--primary' : 'btn'} onClick={() => setMode('keyfile')} disabled={pending}>
              {t('UnlockAllDialog.keyfileTab')}
            </button>
          </div>

          {mode === 'passphrase' ? (
            <div className="settings-field" style={{ marginTop: 8 }}>
              <input
                type="password"
                className="history-input"
                style={{ width: '100%' }}
                placeholder={t('UnlockAllDialog.passphrasePlaceholder')}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                disabled={pending}
                autoFocus
              />
            </div>
          ) : (
            <div className="settings-field" style={{ marginTop: 8 }}>
              <input
                type="file"
                className="history-input"
                style={{ width: '100%' }}
                onChange={(e) => setKeyfile(e.target.files?.[0] ?? null)}
                disabled={pending}
              />
              <div className="toggle-row__desc" style={{ marginTop: 6 }}>
                {t('UnlockAllDialog.keyfileDesc')}
              </div>
            </div>
          )}

          {allSucceeded && <div className="status-note">{t('UnlockAllDialog.allUnlocked')}</div>}

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onClose}>
              {t('UnlockAllDialog.close')}
            </button>
            <button type="button" className="btn--primary" disabled={pending || !canSubmit} onClick={submit}>
              {pending ? t('UnlockAllDialog.unlocking') : t('UnlockAllDialog.unlockAll')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
