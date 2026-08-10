import { useEffect, useRef, useState } from 'react';
import { tlsApi } from '../../api/tlsApi';
import type { TlsStatus } from '../../types/tlsApi';

// Giving the backend's Restart=on-failure (RestartSec=5) plus Node's own startup time to actually
// come back before navigating — same reasoning as ServicesSection's health-poll timeout, but this
// flow can't poll (see the redirect note below), so it's a fixed wait instead.
const RECONNECT_DELAY_MS = 5000;

function formatExpiry(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function TlsSection() {
  const [status, setStatus] = useState<TlsStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [commonNameDraft, setCommonNameDraft] = useState('');
  const [sansDraft, setSansDraft] = useState('');
  const draftInitialized = useRef(false);

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState<string | null>(null); // holds the target origin while waiting

  useEffect(() => {
    tlsApi
      .getStatus()
      .then((s) => {
        setStatus(s);
        if (!draftInitialized.current) {
          draftInitialized.current = true;
          setCommonNameDraft(s.commonName ?? s.suggestedCommonName);
          setSansDraft((s.sans ?? s.suggestedSans).join(', '));
        }
      })
      .catch((err) => setLoadError((err as Error).message));
  }, []);

  const generate = async () => {
    setGenerating(true);
    setGenerateError(null);
    try {
      const sans = sansDraft
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const result = await tlsApi.generateSelfSigned({ commonName: commonNameDraft.trim(), sans });
      setStatus(result);
    } catch (err) {
      setGenerateError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  const apply = async (enable: boolean) => {
    if (!status) return;
    setApplying(true);
    setApplyError(null);
    // Best-effort fallback if the backend's response never arrives (it may exit mid-response,
    // same as the plain webui restart) — this flow can't poll for it, since switching http<->https
    // changes the page's origin and a fetch can never succeed across that change either direction.
    const port = window.location.port ? `:${window.location.port}` : '';
    const fallbackOrigin = `${enable ? 'https' : 'http'}://${status.commonName ?? status.suggestedCommonName}${port}`;
    let newOrigin = fallbackOrigin;
    try {
      const result = await (enable ? tlsApi.enable() : tlsApi.disable());
      newOrigin = result.newOrigin;
    } catch (err) {
      if (!(err instanceof TypeError)) {
        // A real error response (e.g. no certificate configured yet) — not the backend dying
        // mid-restart, which shows up as a network-level TypeError instead.
        setApplyError((err as Error).message);
        setApplying(false);
        return;
      }
    }
    setReconnecting(newOrigin);
    setTimeout(() => {
      window.location.href = newOrigin;
    }, RECONNECT_DELAY_MS);
  };

  if (loadError) return <div className="status-note status-note--error">{loadError}</div>;
  if (!status) return <div className="status-note">Loading…</div>;

  return (
    <div className="settings-field toggle-row--bordered">
      <div className="toggle-row__title">HTTPS</div>
      <div className="toggle-row__desc">
        Passkeys and other secure-context browser features only work over HTTPS. Unblocks
        WebAuthn passkeys when enabled.
      </div>

      <div className="toggle-row__desc">
        HTTPS is currently <strong>{status.enabled ? 'on' : 'off'}</strong>
        {status.configured && (
          <>
            {' '}
            — {status.source === 'self-signed' ? 'self-signed' : 'imported'} certificate for{' '}
            <strong>{status.commonName}</strong>, expires {status.expiresAt ? formatExpiry(status.expiresAt) : '—'}.
          </>
        )}
        {!status.configured && ' — no certificate configured yet.'}
      </div>

      {status.enabled && status.source === 'self-signed' && (
        <div className="status-note">
          Self-signed certificate — your browser will show a security warning the first time you
          visit over HTTPS. This is expected; accept/proceed past it once per browser/device.
        </div>
      )}

      {reconnecting && (
        <div className="status-note">
          Restarting with the new settings — you'll be redirected to <strong>{reconnecting}</strong> in a few
          seconds. If this is a self-signed certificate, your browser will show a security warning; this is
          expected, proceed past it. If it doesn't come back, browse to {reconnecting} directly.
        </div>
      )}
      {applyError && <div className="status-note status-note--error">{applyError}</div>}

      <div className="toggle-row__title" style={{ marginTop: 12 }}>
        Generate a self-signed certificate
      </div>
      <div className="settings-field__row">
        <input
          className="history-input"
          style={{ width: '100%' }}
          value={commonNameDraft}
          onChange={(e) => setCommonNameDraft(e.target.value)}
          placeholder="Common name, e.g. nonraid.lan"
          disabled={!!reconnecting}
        />
      </div>
      <div className="settings-field__row">
        <input
          className="history-input"
          style={{ width: '100%' }}
          value={sansDraft}
          onChange={(e) => setSansDraft(e.target.value)}
          placeholder="Additional hostnames/IPs, comma-separated (DNS:host or IP:address)"
          disabled={!!reconnecting}
        />
        <button type="button" className="btn" disabled={generating || !!reconnecting} onClick={generate}>
          {generating ? 'Generating…' : 'Generate certificate'}
        </button>
      </div>
      {generateError && <div className="status-note status-note--error">{generateError}</div>}

      <div className="settings-field__row" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn"
          disabled={applying || !!reconnecting || (!status.configured && !status.enabled)}
          onClick={() => apply(!status.enabled)}
        >
          {applying || reconnecting ? 'Working…' : status.enabled ? 'Disable HTTPS' : 'Enable HTTPS'}
        </button>
      </div>
    </div>
  );
}
