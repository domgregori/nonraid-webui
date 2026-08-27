import { startRegistration } from '@simplewebauthn/browser';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authApi } from '../../api/authApi';
import type { PasskeySummary } from '../../types/authApi';
import { webauthnAvailable } from '../../utils/webauthnSupport';
import { RemovePasskeyDialog } from './RemovePasskeyDialog';

function formatCreatedAt(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function PasskeySection() {
  const { t } = useTranslation('settings');
  const [passkeys, setPasskeys] = useState<PasskeySummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [removing, setRemoving] = useState<PasskeySummary | null>(null);

  const load = () =>
    authApi
      .twoFactorStatus()
      .then((s) => setPasskeys(s.passkeys))
      .catch((err) => setLoadError((err as Error).message));

  useEffect(() => {
    load();
  }, []);

  const addPasskey = async () => {
    const name = nameDraft.trim() || t('PasskeySection.defaultName');
    setAdding(true);
    setAddError(null);
    try {
      const optionsJSON = await authApi.passkeyRegisterOptions();
      const response = await startRegistration({ optionsJSON });
      await authApi.passkeyRegisterVerify(response, name);
      setNameDraft('');
      load();
    } catch (err) {
      setAddError((err as Error).message);
    } finally {
      setAdding(false);
    }
  };

  if (loadError) return <div className="status-note status-note--error">{loadError}</div>;
  if (!passkeys) return <div className="status-note">{t('PasskeySection.loading')}</div>;

  return (
    <div className="settings-field">
      <div className="toggle-row__title">{t('PasskeySection.title')}</div>
      <div className="toggle-row__desc">{t('PasskeySection.desc')}</div>

      {passkeys.length > 0 && (
        <div className="list">
          {passkeys.map((p) => (
            <div className="list-card" key={p.id}>
              <div className="list-card__col--name">
                <div className="list-card__title">{p.name}</div>
                <div className="list-card__subtitle">{t('PasskeySection.added', { date: formatCreatedAt(p.createdAt) })}</div>
              </div>
              <div className="list-card__actions">
                <button type="button" className="btn btn--danger" onClick={() => setRemoving(p)}>
                  {t('PasskeySection.remove')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {webauthnAvailable() ? (
        <>
          <div className="settings-field__row">
            <input
              className="history-input"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              placeholder={t('PasskeySection.namePlaceholder')}
            />
            <button type="button" className="btn btn--primary" disabled={adding} onClick={addPasskey}>
              {adding ? t('PasskeySection.adding') : t('PasskeySection.addPasskey')}
            </button>
          </div>
          {addError && <div className="status-note status-note--error">{addError}</div>}
        </>
      ) : (
        <div className="status-note">{t('PasskeySection.needsSecureConnection')}</div>
      )}

      {removing && (
        <RemovePasskeyDialog
          passkey={removing}
          onClose={() => setRemoving(null)}
          onDone={() => {
            setRemoving(null);
            load();
          }}
        />
      )}
    </div>
  );
}
