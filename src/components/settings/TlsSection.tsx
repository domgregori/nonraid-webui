import { useEffect, useRef, useState } from 'react';
import { tlsApi } from '../../api/tlsApi';
import type { TlsImportPreview, TlsStatus } from '../../types/tlsApi';

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

  const [certFile, setCertFile] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [preview, setPreview] = useState<TlsImportPreview | null>(null);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

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

  const previewImport = async () => {
    if (!certFile || !keyFile) return;
    setPreviewing(true);
    setPreviewError(null);
    setPreview(null);
    try {
      setPreview(await tlsApi.previewImport(certFile, keyFile));
    } catch (err) {
      setPreviewError((err as Error).message);
    } finally {
      setPreviewing(false);
    }
  };

  const commitImport = async () => {
    if (!preview) return;
    setCommitting(true);
    setCommitError(null);
    try {
      const result = await tlsApi.commitImport(preview.token);
      setStatus(result);
      setPreview(null);
      setCertFile(null);
      setKeyFile(null);
    } catch (err) {
      setCommitError((err as Error).message);
    } finally {
      setCommitting(false);
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

      <div className="toggle-row__title" style={{ marginTop: 12 }}>
        Import a certificate
      </div>
      <div className="toggle-row__desc">A real CA-issued certificate, or one produced by an ACME client run elsewhere.</div>
      <div className="settings-field__row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4, paddingTop: 10 }}>
        <label className="form-field__label form-field__label--strong" style={{ display: 'block' }}>
          Certificate file (.pem, .crt, .cer)
          <input
            type="file"
            className="file-input"
            accept=".pem,.crt,.cer"
            onChange={(e) => {
              setCertFile(e.target.files?.[0] ?? null);
              setPreview(null);
            }}
            disabled={!!reconnecting}
          />
        </label>
        <label className="form-field__label form-field__label--strong" style={{ display: 'block', paddingTop: 10 }}>
          Private key file (.pem, .key)
          <input
            type="file"
            className="file-input"
            accept=".pem,.key"
            onChange={(e) => {
              setKeyFile(e.target.files?.[0] ?? null);
              setPreview(null);
            }}
            disabled={!!reconnecting}
          />
        </label>
      </div>
      <div className="settings-field__row">
        <button
          type="button"
          className="btn"
          style={{ paddingTop: 10 }}
          disabled={previewing || !certFile || !keyFile || !!reconnecting}
          onClick={previewImport}
        >
          {previewing ? 'Checking…' : 'Preview'}
        </button>
      </div>
      {previewError && <div className="status-note status-note--error">{previewError}</div>}
      {preview && (
        <div className="status-note">
          Subject: <strong>{preview.subject}</strong>
          <br />
          Issuer: {preview.issuer}
          <br />
          Expires: {formatExpiry(preview.notAfter)}
          {preview.expiringSoon && ' (expiring soon)'}
          <br />
          Keys match: <strong>{preview.keyMatchesCert ? 'yes' : 'no'}</strong>
          {!preview.keyMatchesCert && ' — this certificate and key don\'t belong together, cannot import.'}
        </div>
      )}
      {commitError && <div className="status-note status-note--error">{commitError}</div>}
      {preview && (
        <div className="settings-field__row">
          <button type="button" className="btn" disabled={committing || !preview.keyMatchesCert || !!reconnecting} onClick={commitImport}>
            {committing ? 'Importing…' : 'Confirm import'}
          </button>
        </div>
      )}

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
