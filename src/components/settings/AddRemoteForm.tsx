import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { rcloneApi } from '../../api/rcloneApi';
import type { RcloneProvider, RcloneRemote } from '../../types/rcloneApi';
import { ConnectRemoteModal } from './ConnectRemoteModal';

interface AddRemoteFormProps {
  providers: RcloneProvider[];
  // When set, edits this already-configured remote's parameters instead of creating a new one -
  // same provider-fields form, just with `name`/type fixed and pre-filled (rclone has no
  // "rename"/"change provider" operation - that's delete + recreate in its own model, see
  // RemoteBackupSection's own doc comment on this). Onboarding never passes this - a from-scratch
  // install only ever adds a brand new remote here.
  editingRemote?: RcloneRemote | null;
  // Fires once the remote is actually usable - either straight after `config/create` returns
  // `done: true`, or after ConnectRemoteModal's guided OAuth setup finishes for a provider that
  // needs one. Callers own what happens next (hide the panel, reload the remotes list, advance to
  // the next onboarding step, ...) - this component only owns getting the remote itself connected.
  onAdded: (remote: { name: string; type: string }) => void;
  onCancel: () => void;
  // Panel heading - defaults to "Add remote"/"Edit remote: <name>". Onboarding overrides this to
  // match its own step copy.
  title?: string;
}

/**
 * The provider picker + dynamic per-provider fields for connecting rclone to a remote -
 * originally built inline in RemoteBackupSection.tsx, extracted here so the onboarding disaster-
 * recovery flow (which needs the exact same "connect a remote" step, but has no existing remote
 * list/job UI around it) can mount the same code instead of forking a second copy of ~150 lines
 * of form rendering.
 *
 * OAuth setup itself (Drive, Dropbox, ...) is a separate guided modal, ConnectRemoteModal - this
 * component only owns the picker/fields and opens that modal at the two points a provider can
 * turn out to need it: the "Connect with X" shortcut, and the manual "Test & Save" submit
 * discovering mid-flight that the provider it just tried needs OAuth after all.
 */
export function AddRemoteForm({ providers, editingRemote = null, onAdded, onCancel, title }: AddRemoteFormProps) {
  const { t } = useTranslation('settings');
  const [remoteType, setRemoteType] = useState(editingRemote?.type ?? providers[0]?.name ?? '');
  const [remoteName, setRemoteName] = useState(editingRemote?.name ?? '');
  const [remoteFields, setRemoteFields] = useState<Record<string, string>>({});
  const [remoteSaving, setRemoteSaving] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [remoteConfigLoading, setRemoteConfigLoading] = useState(!!editingRemote);
  // Set to open ConnectRemoteModal - `initial` unset means "Connect with X" was clicked directly
  // (nothing created yet, the modal calls createRemote itself); set means the manual form already
  // called createRemote and got a needsToken result back, so the modal should resume from there.
  const [connectModal, setConnectModal] = useState<{ name: string; type: string; initial?: { state: string; authUrl: string | null } } | null>(null);
  // Manual credential fields (client_id, client_secret, ...) start rolled up for an OAuth-capable
  // provider - Connect is the primary path there, and most admins never need to look at these.
  // Reset whenever the provider changes so switching away and back doesn't leave a stale expand
  // state. Not used at all for a non-OAuth provider (its fields are the only way to configure it,
  // so they stay always visible) or while editing (the existing behavior there is unchanged).
  const [showManualFields, setShowManualFields] = useState(false);

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

  // `nameOverride` lets the OAuth "Connect" shortcut below seed a default name and submit in the
  // same click, without waiting on a state update round-trip (setRemoteName then reading the still-
  // stale `remoteName` closure value would submit the old, empty name).
  const submitRemote = async (nameOverride?: string) => {
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
    const name = (nameOverride ?? remoteName).trim();
    if (!name || !remoteType) {
      setRemoteError(t('AddRemoteForm.providerAndNameRequired'));
      return;
    }
    if (nameOverride) setRemoteName(nameOverride);
    setRemoteSaving(true);
    setRemoteError(null);
    try {
      const result = await rcloneApi.createRemote(name, remoteType, remoteFields);
      if (result.done) {
        onAdded({ name, type: remoteType });
      } else {
        // The manual form's own fields weren't enough (e.g. no client_id/secret typed, or the
        // provider always needs the interactive OAuth step regardless) - hand off to the same
        // guided modal the Connect shortcut uses, resuming from what config/create already did.
        setConnectModal({ name, type: remoteType, initial: { state: result.state ?? '', authUrl: result.authUrl } });
      }
    } catch (err) {
      setRemoteError((err as Error).message);
    } finally {
      setRemoteSaving(false);
    }
  };

  // The OAuth "Connect" shortcut - seeds a default remote name when the admin hasn't typed one yet
  // (so it works with zero typing), then opens the guided modal, which calls createRemote itself.
  const connectOAuth = () => {
    const name = remoteName.trim() || remoteType;
    setRemoteName(name);
    setConnectModal({ name, type: remoteType });
  };

  const selectedProvider = providers.find((p) => p.name === remoteType) ?? null;

  return (
    <div className="add-remote-panel">
      <div className="add-remote-panel__title">
        {title ?? (editingRemote ? t('AddRemoteForm.editRemoteTitle', { name: editingRemote.name }) : t('AddRemoteForm.addRemoteTitle'))}
      </div>
      {remoteConfigLoading ? (
        <div className="status-note">{t('AddRemoteForm.loading')}</div>
      ) : (
        <>
          <div className="field-grid">
            <label className="field">
              <span>{t('AddRemoteForm.provider')}</span>
              {editingRemote ? (
                // rclone has no "change provider" on an existing remote - that's delete + recreate
                // in its own real-world model, not an edit - so this is fixed.
                <input className="history-input" value={selectedProvider?.description ?? remoteType} disabled />
              ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    className="history-input"
                    style={{ flex: 1, minWidth: 0 }}
                    value={remoteType}
                    onChange={(e) => {
                      setRemoteType(e.target.value);
                      setRemoteFields({});
                      setShowManualFields(false);
                    }}
                  >
                    {providers.map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.description}
                      </option>
                    ))}
                  </select>
                  {selectedProvider?.oauth && (
                    <button type="button" className="btn btn--primary-sm" style={{ flexShrink: 0 }} disabled={remoteSaving} onClick={connectOAuth}>
                      {t('AddRemoteForm.connectWith', { provider: selectedProvider.description })}
                    </button>
                  )}
                </div>
              )}
            </label>
            <label className="field">
              <span>{t('AddRemoteForm.name')}</span>
              <input
                className="history-input"
                value={remoteName}
                onChange={(e) => setRemoteName(e.target.value)}
                placeholder={t('AddRemoteForm.namePlaceholder')}
                disabled={!!editingRemote}
              />
            </label>
            {!editingRemote && selectedProvider?.oauth && selectedProvider.options.length > 0 && (
              <button type="button" className="btn field-grid--full" style={{ justifySelf: 'start' }} onClick={() => setShowManualFields((v) => !v)}>
                {showManualFields ? t('AddRemoteForm.hideManualFields') : t('AddRemoteForm.showManualFields')}
              </button>
            )}
            {(editingRemote || !selectedProvider?.oauth || showManualFields) &&
              selectedProvider?.options.map((opt) => (
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
                      placeholder={editingRemote && opt.isPassword ? t('AddRemoteForm.keepCurrentValue') : opt.default || undefined}
                    />
                  )}
                </label>
              ))}
          </div>
          <div className="settings-field__row">
            <button type="button" className="btn btn--primary-sm" disabled={remoteSaving} onClick={() => submitRemote()}>
              {remoteSaving ? t('AddRemoteForm.saving') : editingRemote ? t('AddRemoteForm.save') : t('AddRemoteForm.testAndSave')}
            </button>
            <button type="button" className="btn" onClick={onCancel}>
              {t('AddRemoteForm.cancel')}
            </button>
          </div>
        </>
      )}
      {remoteError && <div className="status-note status-note--error">{remoteError}</div>}
      {connectModal && (
        <ConnectRemoteModal
          name={connectModal.name}
          type={connectModal.type}
          providerDescription={selectedProvider?.description ?? connectModal.type}
          initial={connectModal.initial}
          onConnected={(remote) => {
            setConnectModal(null);
            onAdded(remote);
          }}
          onClose={() => setConnectModal(null)}
        />
      )}
    </div>
  );
}
