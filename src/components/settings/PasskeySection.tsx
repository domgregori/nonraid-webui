import { startRegistration } from '@simplewebauthn/browser';
import { useEffect, useState } from 'react';
import { authApi } from '../../api/authApi';
import type { PasskeySummary } from '../../types/authApi';
import { webauthnAvailable } from '../../utils/webauthnSupport';
import { RemovePasskeyDialog } from './RemovePasskeyDialog';

function formatCreatedAt(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function PasskeySection() {
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
    const name = nameDraft.trim() || 'Passkey';
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
  if (!passkeys) return <div className="status-note">Loading passkeys…</div>;

  return (
    <div className="settings-field">
      <div className="toggle-row__title">Passkeys</div>
      <div className="toggle-row__desc">
        A hardware key, or your device's built-in Touch ID/Windows Hello, as an alternative second factor to an
        authenticator app.
      </div>

      {passkeys.length > 0 && (
        <div className="list">
          {passkeys.map((p) => (
            <div className="list-card" key={p.id}>
              <div className="list-card__col--name">
                <div className="list-card__title">{p.name}</div>
                <div className="list-card__subtitle">Added {formatCreatedAt(p.createdAt)}</div>
              </div>
              <div className="list-card__actions">
                <button type="button" className="btn btn--danger" onClick={() => setRemoving(p)}>
                  Remove
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
              placeholder="Name this passkey (e.g. YubiKey)"
            />
            <button type="button" className="btn btn--primary" disabled={adding} onClick={addPasskey}>
              {adding ? 'Adding…' : 'Add Passkey'}
            </button>
          </div>
          {addError && <div className="status-note status-note--error">{addError}</div>}
        </>
      ) : (
        <div className="status-note">
          Passkeys need a secure connection (HTTPS, or "localhost") - this page is loaded over plain HTTP, so adding
          one isn't available here.
        </div>
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
