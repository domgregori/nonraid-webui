import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { tailscaleApi } from '../../api/tailscaleApi';
import type { TailscaleStatus } from '../../types/tailscaleApi';
import { ToggleSwitch } from '../shared/ToggleSwitch';

const STATUS_POLL_INTERVAL_MS = 2000;
// tailscale up's own browser-flow window is generous (several minutes) - this just stops this
// component from polling forever if the user never finishes it or closes the tab.
const STATUS_POLL_TIMEOUT_MS = 5 * 60 * 1000;

export function TailscaleSection() {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<TailscaleStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);

  const [loginServerDraft, setLoginServerDraft] = useState('');
  const [showCustomLogin, setShowCustomLogin] = useState(false);
  const draftInitialized = useRef(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [waitingForAuth, setWaitingForAuth] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  const [hostnameDraft, setHostnameDraft] = useState('');
  const [advertiseRoutesDraft, setAdvertiseRoutesDraft] = useState('');
  const [savingOptions, setSavingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsNote, setOptionsNote] = useState<string | null>(null);

  const load = () =>
    tailscaleApi
      .getStatus()
      .then((s) => {
        setStatus(s);
        if (!draftInitialized.current) {
          draftInitialized.current = true;
          setLoginServerDraft(s.loginServer);
          if (s.loginServer) setShowCustomLogin(true);
          setHostnameDraft(s.hostname ?? '');
          setAdvertiseRoutesDraft(s.advertiseRoutes.join(', '));
        }
        return s;
      })
      .catch((err) => setLoadError((err as Error).message));

  useEffect(() => {
    load();
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  const toggleEnabled = async () => {
    if (!status) return;
    setEnabling(true);
    setEnableError(null);
    try {
      await tailscaleApi.setEnabled(!status.featureEnabled);
      await load();
    } catch (err) {
      setEnableError((err as Error).message);
    } finally {
      setEnabling(false);
    }
  };

  const startAuthPoll = () => {
    const startedAt = Date.now();
    setWaitingForAuth(true);
    pollTimer.current = setInterval(async () => {
      const s = await load();
      if (s?.loggedIn) {
        setWaitingForAuth(false);
        setAuthUrl(null);
        if (pollTimer.current) clearInterval(pollTimer.current);
        return;
      }
      if (Date.now() - startedAt > STATUS_POLL_TIMEOUT_MS) {
        setWaitingForAuth(false);
        if (pollTimer.current) clearInterval(pollTimer.current);
      }
    }, STATUS_POLL_INTERVAL_MS);
  };

  const login = async () => {
    setLoggingIn(true);
    setLoginError(null);
    setAuthUrl(null);
    try {
      const result = await tailscaleApi.login(loginServerDraft.trim());
      if (result.authUrl) {
        setAuthUrl(result.authUrl);
        startAuthPoll();
      } else {
        await load();
      }
    } catch (err) {
      setLoginError((err as Error).message);
    } finally {
      setLoggingIn(false);
    }
  };

  const logout = async () => {
    setLoggingOut(true);
    setLogoutError(null);
    try {
      await tailscaleApi.logout();
      setAuthUrl(null);
      await load();
    } catch (err) {
      setLogoutError((err as Error).message);
    } finally {
      setLoggingOut(false);
    }
  };

  const saveHostname = async () => {
    setSavingOptions(true);
    setOptionsError(null);
    setOptionsNote(null);
    try {
      await tailscaleApi.setOptions({ hostname: hostnameDraft.trim() });
      await load();
      setOptionsNote(t('TailscaleSection.saved'));
    } catch (err) {
      setOptionsError((err as Error).message);
    } finally {
      setSavingOptions(false);
    }
  };

  const setToggleOption = async (patch: { ssh?: boolean; acceptDns?: boolean; acceptRoutes?: boolean }) => {
    setSavingOptions(true);
    setOptionsError(null);
    setOptionsNote(null);
    try {
      await tailscaleApi.setOptions(patch);
      await load();
    } catch (err) {
      setOptionsError((err as Error).message);
    } finally {
      setSavingOptions(false);
    }
  };

  const saveAdvertiseRoutes = async () => {
    setSavingOptions(true);
    setOptionsError(null);
    setOptionsNote(null);
    try {
      const advertiseRoutes = advertiseRoutesDraft
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);
      await tailscaleApi.setOptions({ advertiseRoutes });
      await load();
      setOptionsNote(t('TailscaleSection.savedAdvertiseRoutes'));
    } catch (err) {
      setOptionsError((err as Error).message);
    } finally {
      setSavingOptions(false);
    }
  };

  if (loadError) return <div className="status-note status-note--error">{loadError}</div>;
  if (!status) return <div className="status-note">{t('TailscaleSection.loading')}</div>;

  if (!status.installed) {
    return (
      <div className="settings-field toggle-row--bordered">
        <div className="toggle-row__title">{t('TailscaleSection.title')}</div>
        <div className="toggle-row__desc">
          {t('TailscaleSection.notInstalled1')} <code>tailscale</code> {t('TailscaleSection.notInstalled2')} <code>tools/install-webui.sh</code>{' '}
          {t('TailscaleSection.notInstalled3')}
        </div>
      </div>
    );
  }

  return (
    <div className="settings-field toggle-row--bordered">
      <div className="toggle-row">
        <div>
          <div className="toggle-row__title">{t('TailscaleSection.title')}</div>
          <div className="toggle-row__desc">{t('TailscaleSection.desc')}</div>
        </div>
        <ToggleSwitch on={status.featureEnabled} onToggle={toggleEnabled} label={t('TailscaleSection.title')} disabled={enabling} />
      </div>
      {enableError && <div className="status-note status-note--error">{enableError}</div>}

      {status.featureEnabled && (
        <>
          {!status.loggedIn && !showCustomLogin && (
            <div className="settings-field__row" style={{ marginTop: 12 }}>
              <button type="button" className="btn" disabled={loggingIn || waitingForAuth} onClick={login}>
                {loggingIn ? t('TailscaleSection.starting') : waitingForAuth ? t('TailscaleSection.waitingForLogin') : t('TailscaleSection.logIn')}
              </button>
              <button type="button" className="btn" onClick={() => setShowCustomLogin(true)}>
                {t('TailscaleSection.customLoginServer')}
              </button>
            </div>
          )}

          {(showCustomLogin || status.loggedIn) && (
            <>
              <div className="toggle-row__title" style={{ marginTop: 12 }}>
                {t('TailscaleSection.loginServer')}
              </div>
              <div className="toggle-row__desc">{t('TailscaleSection.loginServerHint')}</div>
              <div className="settings-field__row">
                <input
                  className="history-input"
                  style={{ width: '100%' }}
                  value={loginServerDraft}
                  onChange={(e) => setLoginServerDraft(e.target.value)}
                  placeholder="https://headscale.example.com"
                  disabled={status.loggedIn || loggingIn}
                />
              </div>

              {!status.loggedIn && (
                <div className="settings-field__row" style={{ marginTop: 8 }}>
                  <button type="button" className="btn" disabled={loggingIn || waitingForAuth} onClick={login}>
                    {loggingIn ? t('TailscaleSection.starting') : waitingForAuth ? t('TailscaleSection.waitingForLogin') : t('TailscaleSection.logIn')}
                  </button>
                </div>
              )}
            </>
          )}
          {loginError && <div className="status-note status-note--error">{loginError}</div>}
          {authUrl && (
            <div className="status-note">
              {t('TailscaleSection.openLinkToSignIn')}
              <br />
              <a href={authUrl} target="_blank" rel="noreferrer">
                {authUrl}
              </a>
            </div>
          )}

          {status.loggedIn && (
            <>
              <div className="toggle-row__title" style={{ marginTop: 12 }}>
                {t('TailscaleSection.connected')}
              </div>
              <div className="toggle-row__desc">
                {status.hostname && (
                  <>
                    {t('TailscaleSection.hostname')} <strong>{status.hostname}</strong>
                    <br />
                  </>
                )}
                {status.tailscaleIps.length > 0 && (
                  <>
                    {t('TailscaleSection.ips')} <strong>{status.tailscaleIps.join(', ')}</strong>
                    <br />
                  </>
                )}
                {status.dnsName && (
                  <>
                    {t('TailscaleSection.dnsName')} <strong>{status.dnsName.replace(/\.$/, '')}</strong>
                    <br />
                  </>
                )}
                {status.tailnetName && (
                  <>
                    {t('TailscaleSection.tailnet')} <strong>{status.tailnetName}</strong>
                  </>
                )}
              </div>
              <div className="settings-field__row" style={{ marginTop: 8 }}>
                <button type="button" className="btn" disabled={loggingOut} onClick={logout}>
                  {loggingOut ? t('TailscaleSection.loggingOut') : t('TailscaleSection.logOut')}
                </button>
              </div>
              {logoutError && <div className="status-note status-note--error">{logoutError}</div>}

              <div className="toggle-row__title" style={{ marginTop: 12 }}>
                {t('TailscaleSection.hostnameTitle')}
              </div>
              <div className="settings-field__row">
                <input
                  className="history-input"
                  style={{ width: '100%' }}
                  value={hostnameDraft}
                  onChange={(e) => setHostnameDraft(e.target.value)}
                  disabled={savingOptions}
                />
                <button type="button" className="btn" disabled={savingOptions} onClick={saveHostname}>
                  {savingOptions ? t('TailscaleSection.saving') : t('TailscaleSection.save')}
                </button>
              </div>

              <div className="toggle-row" style={{ marginTop: 8 }}>
                <div>
                  <div className="toggle-row__title">{t('TailscaleSection.tailscaleSsh')}</div>
                  <div className="toggle-row__desc">{t('TailscaleSection.tailscaleSshDesc')}</div>
                </div>
                <ToggleSwitch
                  on={status.ssh}
                  onToggle={() => setToggleOption({ ssh: !status.ssh })}
                  label={t('TailscaleSection.tailscaleSsh')}
                  disabled={savingOptions}
                />
              </div>

              <div className="toggle-row">
                <div>
                  <div className="toggle-row__title">{t('TailscaleSection.acceptDns')}</div>
                  <div className="toggle-row__desc">{t('TailscaleSection.acceptDnsDesc')}</div>
                </div>
                <ToggleSwitch
                  on={status.acceptDns}
                  onToggle={() => setToggleOption({ acceptDns: !status.acceptDns })}
                  label={t('TailscaleSection.acceptDns')}
                  disabled={savingOptions}
                />
              </div>

              <div className="toggle-row__title" style={{ marginTop: 8 }}>
                {t('TailscaleSection.advertiseLan')}
              </div>
              <div className="toggle-row__desc">{t('TailscaleSection.advertiseLanDesc')}</div>
              <div className="settings-field__row">
                <input
                  className="history-input"
                  style={{ width: '100%' }}
                  value={advertiseRoutesDraft}
                  onChange={(e) => setAdvertiseRoutesDraft(e.target.value)}
                  placeholder="192.168.1.0/24"
                  disabled={savingOptions}
                />
                <button type="button" className="btn" disabled={savingOptions} onClick={saveAdvertiseRoutes}>
                  {savingOptions ? t('TailscaleSection.saving') : t('TailscaleSection.save')}
                </button>
              </div>

              <div className="toggle-row" style={{ marginTop: 8 }}>
                <div>
                  <div className="toggle-row__title">{t('TailscaleSection.acceptRoutesTitle')}</div>
                  <div className="toggle-row__desc">{t('TailscaleSection.acceptRoutesDesc')}</div>
                </div>
                <ToggleSwitch
                  on={status.acceptRoutes}
                  onToggle={() => setToggleOption({ acceptRoutes: !status.acceptRoutes })}
                  label={t('TailscaleSection.acceptRoutesLabel')}
                  disabled={savingOptions}
                />
              </div>

              {optionsNote && <div className="status-note">{optionsNote}</div>}
              {optionsError && <div className="status-note status-note--error">{optionsError}</div>}
            </>
          )}
        </>
      )}
    </div>
  );
}
