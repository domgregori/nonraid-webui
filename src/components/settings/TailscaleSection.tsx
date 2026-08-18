import { useEffect, useRef, useState } from 'react';
import { tailscaleApi } from '../../api/tailscaleApi';
import type { TailscaleStatus } from '../../types/tailscaleApi';
import { ToggleSwitch } from '../shared/ToggleSwitch';

const STATUS_POLL_INTERVAL_MS = 2000;
// tailscale up's own browser-flow window is generous (several minutes) - this just stops this
// component from polling forever if the user never finishes it or closes the tab.
const STATUS_POLL_TIMEOUT_MS = 5 * 60 * 1000;

export function TailscaleSection() {
  const [status, setStatus] = useState<TailscaleStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);

  const [loginServerDraft, setLoginServerDraft] = useState('');
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
      setOptionsNote('Saved.');
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
      setOptionsNote('Saved. Advertised routes may need approval in your Tailscale/Headscale admin console before they take effect.');
    } catch (err) {
      setOptionsError((err as Error).message);
    } finally {
      setSavingOptions(false);
    }
  };

  if (loadError) return <div className="status-note status-note--error">{loadError}</div>;
  if (!status) return <div className="status-note">Loading…</div>;

  if (!status.installed) {
    return (
      <div className="settings-field toggle-row--bordered">
        <div className="toggle-row__title">Tailscale</div>
        <div className="toggle-row__desc">
          The <code>tailscale</code> package isn't installed on this host. Re-run <code>tools/install-webui.sh</code>{' '}
          (or install it manually) to enable this section.
        </div>
      </div>
    );
  }

  return (
    <div className="settings-field toggle-row--bordered">
      <div className="toggle-row">
        <div>
          <div className="toggle-row__title">Tailscale</div>
          <div className="toggle-row__desc">
            Reach this NAS securely from anywhere over your tailnet, without opening any ports. Uses Tailscale's own
            coordination server by default, or a self-hosted Headscale instance.
          </div>
        </div>
        <ToggleSwitch on={status.featureEnabled} onToggle={toggleEnabled} label="Tailscale" disabled={enabling} />
      </div>
      {enableError && <div className="status-note status-note--error">{enableError}</div>}

      {status.featureEnabled && (
        <>
          <div className="toggle-row__title" style={{ marginTop: 12 }}>
            Login server
          </div>
          <div className="toggle-row__desc">Leave blank to use Tailscale's own server, or set a self-hosted Headscale URL.</div>
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
                {loggingIn ? 'Starting…' : waitingForAuth ? 'Waiting for login…' : 'Log in'}
              </button>
            </div>
          )}
          {loginError && <div className="status-note status-note--error">{loginError}</div>}
          {authUrl && (
            <div className="status-note">
              Open this link to finish signing in (works from any device):
              <br />
              <a href={authUrl} target="_blank" rel="noreferrer">
                {authUrl}
              </a>
            </div>
          )}

          {status.loggedIn && (
            <>
              <div className="toggle-row__title" style={{ marginTop: 12 }}>
                Connected
              </div>
              <div className="toggle-row__desc">
                {status.hostname && <>Hostname: <strong>{status.hostname}</strong><br /></>}
                {status.tailscaleIps.length > 0 && <>IPs: <strong>{status.tailscaleIps.join(', ')}</strong><br /></>}
                {status.dnsName && <>DNS name: <strong>{status.dnsName.replace(/\.$/, '')}</strong><br /></>}
                {status.tailnetName && <>Tailnet: <strong>{status.tailnetName}</strong></>}
              </div>
              <div className="settings-field__row" style={{ marginTop: 8 }}>
                <button type="button" className="btn" disabled={loggingOut} onClick={logout}>
                  {loggingOut ? 'Logging out…' : 'Log out'}
                </button>
              </div>
              {logoutError && <div className="status-note status-note--error">{logoutError}</div>}

              <div className="toggle-row__title" style={{ marginTop: 12 }}>
                Hostname
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
                  {savingOptions ? 'Saving…' : 'Save'}
                </button>
              </div>

              <div className="toggle-row" style={{ marginTop: 8 }}>
                <div>
                  <div className="toggle-row__title">Tailscale SSH</div>
                  <div className="toggle-row__desc">Lets tailnet members SSH into this host through Tailscale, using its own access rules.</div>
                </div>
                <ToggleSwitch on={status.ssh} onToggle={() => setToggleOption({ ssh: !status.ssh })} label="Tailscale SSH" disabled={savingOptions} />
              </div>

              <div className="toggle-row">
                <div>
                  <div className="toggle-row__title">Accept DNS</div>
                  <div className="toggle-row__desc">Use the DNS settings (including MagicDNS) configured for your tailnet.</div>
                </div>
                <ToggleSwitch
                  on={status.acceptDns}
                  onToggle={() => setToggleOption({ acceptDns: !status.acceptDns })}
                  label="Accept DNS"
                  disabled={savingOptions}
                />
              </div>

              <div className="toggle-row__title" style={{ marginTop: 8 }}>
                Advertise this NAS's LAN
              </div>
              <div className="toggle-row__desc">
                CIDRs to advertise as subnet routes, comma-separated (e.g. 192.168.1.0/24) - lets other tailnet
                devices reach your home network through this NAS. Disabled by default; each route also needs
                approving in your Tailscale/Headscale admin console.
              </div>
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
                  {savingOptions ? 'Saving…' : 'Save'}
                </button>
              </div>

              <div className="toggle-row" style={{ marginTop: 8 }}>
                <div>
                  <div className="toggle-row__title">Accept routes from other nodes</div>
                  <div className="toggle-row__desc">Let this NAS reach subnets advertised by other devices on your tailnet. Disabled by default.</div>
                </div>
                <ToggleSwitch
                  on={status.acceptRoutes}
                  onToggle={() => setToggleOption({ acceptRoutes: !status.acceptRoutes })}
                  label="Accept routes"
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
