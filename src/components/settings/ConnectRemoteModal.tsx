import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rcloneApi } from '../../api/rcloneApi';

interface ConnectRemoteModalProps {
  name: string;
  type: string;
  providerDescription: string;
  // Set when the manual "Test & Save" form already ran config/create itself (the admin typed
  // their own client_id/secret and it still needed OAuth) - skip straight to the authorize step
  // instead of calling createRemote again. Left unset for the "Connect with X" shortcut, which
  // hasn't created anything yet when this modal opens.
  initial?: { state: string; authUrl: string | null };
  onConnected: (remote: { name: string; type: string }) => void;
  onClose: () => void;
}

type Step = 'connecting' | 'authorize' | 'result';

// rclone's real, current install command per platform - kept short and native-package-manager-
// first (matches what an admin on that OS actually reaches for) rather than the universal curl
// installer script, with a link to rclone's own docs as the fallback for anything else.
const INSTALL_COMMANDS: { os: string; command: string }[] = [
  { os: 'Debian / Ubuntu', command: 'sudo apt install rclone' },
  { os: 'Fedora', command: 'sudo dnf install rclone' },
  { os: 'Arch Linux', command: 'sudo pacman -S rclone' },
  { os: 'macOS', command: 'brew install rclone' },
  { os: 'Windows', command: 'winget install Rclone.Rclone' },
];

/**
 * The guided, step-by-step version of connecting an OAuth-capable rclone remote - a modal so it
 * reads as its own focused task rather than an inline panel bolted onto the Add Remote form.
 *
 * Two real steps: 'authorize' (run `rclone authorize "<type>"` elsewhere, paste the result) and
 * 'result' (done). 'connecting' is a brief transitional state while the initial config/create
 * call resolves (skipped entirely when `initial` is already provided).
 *
 * This is a paste-a-token flow, not a click-through link: this backend always runs headless, so
 * rclone's own directly-openable authUrl mechanism never actually works here (it's hardcoded to
 * redirect to 127.0.0.1 on whichever machine runs rclone - see RcloneRemoteSetupResult's doc
 * comment, backend/src/rclone/types.ts, for the full story, verified against rclone's own
 * source). The admin instead runs `rclone authorize "<type>"` on any machine that has both rclone
 * and a browser, and pastes the resulting token back here.
 */
export function ConnectRemoteModal({ name, type, providerDescription, initial, onConnected, onClose }: ConnectRemoteModalProps) {
  const { t } = useTranslation('settings');
  const [step, setStep] = useState<Step>(initial ? 'authorize' : 'connecting');
  const [authState, setAuthState] = useState<{ state: string; authUrl: string | null } | null>(initial ?? null);
  const [tokenDraft, setTokenDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);

  // Starts the connection the moment the modal opens, for the "Connect with X" shortcut path -
  // `initial` being already set (the manual-form path) means this has already happened, so this
  // effect is a no-op then. Real config/create calls resolve in well under a second in practice,
  // but the 'connecting' step still covers that gap with a status note rather than a blank modal.
  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    setStep('connecting');
    setError(null);
    rcloneApi
      .createRemote(name, type, {})
      .then((result) => {
        if (cancelled) return;
        if (result.done) {
          setStep('result');
        } else {
          setAuthState({ state: result.state ?? '', authUrl: result.authUrl });
          setStep('authorize');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message);
        setStep('authorize');
      });
    return () => {
      cancelled = true;
    };
    // Intentionally only re-runs if the admin retries after a failure (see retryConnect) - not on
    // every render, and `initial` is fixed for the modal's whole lifetime (a new `key` remounts it
    // instead of swapping props, same convention AddRemoteForm's own callers already use).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const retryConnect = () => {
    setBusy(true);
    setError(null);
    rcloneApi
      .createRemote(name, type, {})
      .then((result) => {
        if (result.done) {
          setStep('result');
        } else {
          setAuthState({ state: result.state ?? '', authUrl: result.authUrl });
        }
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setBusy(false));
  };

  const submitToken = async () => {
    if (!authState) return;
    if (!tokenDraft.trim()) {
      setError(t('ConnectRemoteModal.tokenRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await rcloneApi.continueRemoteSetup(name, type, authState.state, tokenDraft.trim());
      if (result.done) {
        setStep('result');
      } else {
        // Rare: rclone rejected the pasted token and is asking for it again (e.g. malformed
        // paste) - same step, let the admin correct it and retry rather than starting over.
        setAuthState({ state: result.state ?? '', authUrl: result.authUrl });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // Leaving mid-authorize abandons a half-configured remote (config/create already wrote a
  // config-file entry for it, just without a valid token yet - confirmed live, it shows up in the
  // remotes list immediately as "Auth expired") - clean it up rather than leaving a broken entry.
  const cancel = async () => {
    if (step === 'authorize') await rcloneApi.deleteRemote(name).catch(() => {});
    onClose();
  };

  return (
    <>
      <div className="detail-overlay" onClick={() => !busy && cancel()} />
      <div className="dialog connect-remote-modal">
        <div className="dialog__head">
          <div className="dialog__title">{t('ConnectRemoteModal.title', { provider: providerDescription })}</div>
          <button type="button" className="detail-panel__close" onClick={cancel} disabled={busy} aria-label={t('ConnectRemoteModal.close')}>
            &#10005;
          </button>
        </div>
        <div className="dialog__body">
          {step === 'connecting' && <div className="status-note">{t('ConnectRemoteModal.connecting')}</div>}

          {step === 'authorize' && (
            <>
              <div className="toggle-row__desc">{t('ConnectRemoteModal.instructions')}</div>
              <div className="cli-block">
                <span className="cli-block__prompt">$</span>
                <span className="cli-block__command">
                  rclone authorize &quot;{type}&quot;
                </span>
              </div>
              <div>
                <button type="button" className="btn" onClick={() => setShowInstallHelp((v) => !v)}>
                  {showInstallHelp ? t('ConnectRemoteModal.hideInstallHelp') : t('ConnectRemoteModal.showInstallHelp')}
                </button>
                {showInstallHelp && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                    {INSTALL_COMMANDS.map(({ os, command }) => (
                      <div key={os}>
                        <div className="settings-field__label">{os}</div>
                        <div className="cli-block cli-block--sm">
                          <span className="cli-block__prompt">$</span>
                          <span className="cli-block__command">{command}</span>
                        </div>
                      </div>
                    ))}
                    <div className="toggle-row__desc">
                      <a href="https://rclone.org/install/" target="_blank" rel="noreferrer">
                        {t('ConnectRemoteModal.installDocs')}
                      </a>
                    </div>
                  </div>
                )}
              </div>

              {authState?.authUrl && (
                <a href={authState.authUrl} target="_blank" rel="noreferrer">
                  {authState.authUrl}
                </a>
              )}
              <label className="field">
                <span>{t('ConnectRemoteModal.tokenLabel')}</span>
                <textarea
                  className="history-input"
                  style={{ width: '100%', minHeight: 80, fontFamily: 'var(--font-mono)', fontSize: 11 }}
                  value={tokenDraft}
                  onChange={(e) => setTokenDraft(e.target.value)}
                  placeholder={t('ConnectRemoteModal.tokenPlaceholder')}
                  autoFocus
                />
              </label>
              {error && <div className="status-note status-note--error">{error}</div>}
              <div className="dialog__actions">
                <button type="button" className="btn" onClick={cancel} disabled={busy}>
                  {t('ConnectRemoteModal.cancel')}
                </button>
                {!authState && (
                  <button type="button" className="btn" onClick={retryConnect} disabled={busy}>
                    {t('ConnectRemoteModal.retry')}
                  </button>
                )}
                {authState && (
                  <button type="button" className="btn btn--primary" disabled={busy} onClick={submitToken}>
                    {busy ? t('ConnectRemoteModal.checking') : t('ConnectRemoteModal.submitToken')}
                  </button>
                )}
              </div>
            </>
          )}

          {step === 'result' && (
            <>
              <div className="status-note">{t('ConnectRemoteModal.connected', { name })}</div>
              <div className="dialog__actions">
                <button type="button" className="btn btn--primary" onClick={() => onConnected({ name, type })}>
                  {t('ConnectRemoteModal.done')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
