import { useEffect, useState } from 'react';
import { rcloneApi } from '../../api/rcloneApi';
import type { RcloneProvider, RcloneRemote } from '../../types/rcloneApi';

interface AddRemoteFormProps {
  providers: RcloneProvider[];
  // When set, edits this already-configured remote's parameters instead of creating a new one -
  // same provider-fields form, just with `name`/type fixed and pre-filled (rclone has no
  // "rename"/"change provider" operation - that's delete + recreate in its own model, see
  // RemoteBackupSection's own doc comment on this). Onboarding never passes this - a from-scratch
  // install only ever adds a brand new remote here.
  editingRemote?: RcloneRemote | null;
  // Fires once the remote is actually usable - either straight after `config/create` returns
  // `done: true`, or after the OAuth `authUrl`-then-Continue dance finishes for a provider that
  // needs one. Callers own what happens next (hide the panel, reload the remotes list, advance to
  // the next onboarding step, ...) - this component only owns getting the remote itself connected.
  onAdded: (remote: { name: string; type: string }) => void;
  onCancel: () => void;
  // Panel heading - defaults to "Add remote"/"Edit remote: <name>". Onboarding overrides this to
  // match its own step copy.
  title?: string;
}

/**
 * The provider picker + dynamic per-provider fields + OAuth authUrl-then-Continue dance for
 * connecting rclone to a remote - originally built inline in RemoteBackupSection.tsx, extracted
 * here so the onboarding disaster-recovery flow (which needs the exact same "connect a remote"
 * step, but has no existing remote list/job UI around it) can mount the same code instead of
 * forking a second copy of ~150 lines of form rendering.
 */
export function AddRemoteForm({ providers, editingRemote = null, onAdded, onCancel, title }: AddRemoteFormProps) {
  const [remoteType, setRemoteType] = useState(editingRemote?.type ?? providers[0]?.name ?? '');
  const [remoteName, setRemoteName] = useState(editingRemote?.name ?? '');
  const [remoteFields, setRemoteFields] = useState<Record<string, string>>({});
  const [remoteSaving, setRemoteSaving] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [remoteConfigLoading, setRemoteConfigLoading] = useState(!!editingRemote);
  const [remoteAuth, setRemoteAuth] = useState<{ name: string; type: string; authUrl: string | null; state: string } | null>(null);

  // Providers load asynchronously (a live rclone RC call) - a mount that races ahead of that fetch
  // starts with an empty picker and fills in the first option once the list actually arrives,
  // rather than being stuck on '' forever.
  useEffect(() => {
    if (!editingRemote && !remoteType && providers.length > 0) setRemoteType(providers[0].name);
  }, [providers, editingRemote, remoteType]);

  useEffect(() => {
    if (!editingRemote) return;
    setRemoteConfigLoading(true);
    rcloneApi
      .getRemoteConfig(editingRemote.name)
      .then((cfg) => {
        // Never pre-fill a password/secret field with its saved (obscured) value - leave it blank
        // with a placeholder instead; only send it back if the admin actually types a new value.
        const provider = providers.find((p) => p.name === cfg.type);
        const prefill: Record<string, string> = {};
        for (const opt of provider?.options ?? []) {
          if (opt.isPassword) continue;
          if (cfg.parameters[opt.name] !== undefined) prefill[opt.name] = cfg.parameters[opt.name];
        }
        setRemoteFields(prefill);
      })
      .catch((err) => setRemoteError((err as Error).message))
      .finally(() => setRemoteConfigLoading(false));
    // Only re-runs if the caller swaps which remote is being edited (via a `key` change on this
    // component in practice - see RemoteBackupSection.tsx) - providers itself doesn't change mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingRemote]);

  const submitRemote = async () => {
    if (editingRemote) {
      setRemoteSaving(true);
      setRemoteError(null);
      try {
        await rcloneApi.updateRemote(editingRemote.name, remoteFields);
        onAdded({ name: editingRemote.name, type: editingRemote.type });
      } catch (err) {
        setRemoteError((err as Error).message);
      } finally {
        setRemoteSaving(false);
      }
      return;
    }
    if (!remoteName.trim() || !remoteType) {
      setRemoteError('Provider and name are required.');
      return;
    }
    setRemoteSaving(true);
    setRemoteError(null);
    try {
      const result = await rcloneApi.createRemote(remoteName.trim(), remoteType, remoteFields);
      if (result.done) {
        onAdded({ name: remoteName.trim(), type: remoteType });
      } else {
        setRemoteAuth({ name: remoteName.trim(), type: remoteType, authUrl: result.authUrl, state: result.state ?? '' });
      }
    } catch (err) {
      setRemoteError((err as Error).message);
    } finally {
      setRemoteSaving(false);
    }
  };

  const continueRemoteAuth = async () => {
    if (!remoteAuth) return;
    setRemoteSaving(true);
    setRemoteError(null);
    try {
      const result = await rcloneApi.continueRemoteSetup(remoteAuth.name, remoteAuth.type, remoteAuth.state);
      if (result.done) {
        onAdded({ name: remoteAuth.name, type: remoteAuth.type });
      } else {
        setRemoteAuth({ ...remoteAuth, authUrl: result.authUrl, state: result.state ?? '' });
      }
    } catch (err) {
      setRemoteError((err as Error).message);
    } finally {
      setRemoteSaving(false);
    }
  };

  const selectedProvider = providers.find((p) => p.name === remoteType) ?? null;

  return (
    <div className="add-remote-panel">
      <div className="add-remote-panel__title">{title ?? (editingRemote ? `Edit remote: ${editingRemote.name}` : 'Add remote')}</div>
      {remoteConfigLoading ? (
        <div className="status-note">Loading…</div>
      ) : !remoteAuth ? (
        <>
          <div className="field-grid">
            <label className="field">
              <span>Provider</span>
              {editingRemote ? (
                // rclone has no "change provider" on an existing remote - that's delete + recreate
                // in its own real-world model, not an edit - so this is fixed.
                <input className="history-input" value={selectedProvider?.description ?? remoteType} disabled />
              ) : (
                <select
                  className="history-input"
                  value={remoteType}
                  onChange={(e) => {
                    setRemoteType(e.target.value);
                    setRemoteFields({});
                  }}
                >
                  {providers.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.description}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <label className="field">
              <span>Name</span>
              <input className="history-input" value={remoteName} onChange={(e) => setRemoteName(e.target.value)} placeholder="e.g. offsite-b2" disabled={!!editingRemote} />
            </label>
            {selectedProvider?.options.map((opt) => (
              <label className="field" key={opt.name}>
                <span>{opt.help.split('\n')[0]}</span>
                {opt.type === 'bool' ? (
                  <input
                    className="round-checkbox"
                    type="checkbox"
                    checked={remoteFields[opt.name] === 'true'}
                    onChange={(e) =>
                      setRemoteFields((prev) => ({
                        ...prev,
                        [opt.name]: String(e.target.checked),
                      }))
                    }
                  />
                ) : (
                  <input
                    className="history-input"
                    type={opt.isPassword ? 'password' : 'text'}
                    value={remoteFields[opt.name] ?? ''}
                    onChange={(e) =>
                      setRemoteFields((prev) => ({
                        ...prev,
                        [opt.name]: e.target.value,
                      }))
                    }
                    placeholder={editingRemote && opt.isPassword ? 'Leave blank to keep the current value' : opt.default || undefined}
                  />
                )}
              </label>
            ))}
          </div>
          <div className="settings-field__row">
            <button type="button" className="btn btn--primary-sm" disabled={remoteSaving} onClick={submitRemote}>
              {remoteSaving ? 'Saving…' : editingRemote ? 'Save' : 'Test & Save'}
            </button>
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="settings-field" style={{ padding: 0 }}>
          <div className="toggle-row__desc">This provider needs one more step to authorize. Open the link below, finish signing in, then come back and click Continue.</div>
          {remoteAuth.authUrl && (
            <a href={remoteAuth.authUrl} target="_blank" rel="noreferrer">
              {remoteAuth.authUrl}
            </a>
          )}
          <div className="settings-field__row" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn--primary-sm" disabled={remoteSaving} onClick={continueRemoteAuth}>
              {remoteSaving ? 'Checking…' : 'Continue'}
            </button>
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {remoteError && <div className="status-note status-note--error">{remoteError}</div>}
    </div>
  );
}
