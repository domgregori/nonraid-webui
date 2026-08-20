import { useEffect, useState } from 'react';
import { rcloneApi } from '../../api/rcloneApi';
import type { RcloneProvider, RcloneRemote } from '../../types/rcloneApi';
import type { BackupCategoryId } from '../../types/systemApi';
import { AddRemoteForm } from '../settings/AddRemoteForm';
import { RestoreFromRemoteWizard } from '../settings/RestoreFromRemoteWizard';

interface RemoteRestoreOnboardingProps {
  onClose: () => void;
  onRestored?: () => void;
  // Threaded straight through to RestoreFromRemoteWizard/ConfigRestoreWizard - see their own doc
  // comments on this prop.
  focusCategory?: BackupCategoryId;
}

type Step =
  | 'loading' // turning Remote Backup on (first visit only) and fetching providers/remotes
  | 'remotes' // pick an already-configured remote, or add a new one
  | 'addRemote' // AddRemoteForm - the only step reachable when nothing's configured yet
  | 'path' // plain remote-path text input for the picked remote
  | 'browse'; // RestoreFromRemoteWizard itself, in its browsePath mode

/**
 * Onboarding's own "restore from a remote backup" entry point - RestoreFromRemoteWizard on its
 * own is job-based (pick a configured sync job, then one of its own archives), which is a dead
 * end on a from-scratch install: there's no settings, no remotes, and no jobs yet. This component
 * is what gets a fresh install from "nothing configured" to that same wizard's browsePath mode
 * (an arbitrary remote+path, no job required) - turn Remote Backup on, connect to (or pick) a
 * remote, type roughly where the old sync job used to point, then hand off to the exact same
 * archive-list/password-prompt/preview UI every other restore source shares.
 */
export function RemoteRestoreOnboarding({ onClose, onRestored, focusCategory }: RemoteRestoreOnboardingProps) {
  const [step, setStep] = useState<Step>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [providers, setProviders] = useState<RcloneProvider[]>([]);
  const [remotes, setRemotes] = useState<RcloneRemote[]>([]);
  const [remoteName, setRemoteName] = useState<string | null>(null);
  const [remotePathDraft, setRemotePathDraft] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await rcloneApi.getStatus();
        if (!status.installed) {
          if (!cancelled) setLoadError("The rclone package isn't installed on this host - re-run tools/install-webui.sh on it to enable remote backups.");
          return;
        }
        // rclone-rcd starts disabled by default (tools/install-webui.sh) - this is the one place
        // in onboarding that needs it running at all, so it's switched on here automatically
        // rather than making the admin find the Settings toggle mid-disaster-recovery. Same call
        // Settings → Remote Backup's own switch uses.
        if (!status.featureEnabled) await rcloneApi.setEnabled(true);
        const [prov, rem] = await Promise.all([rcloneApi.getProviders(), rcloneApi.getRemotes()]);
        if (cancelled) return;
        setProviders(prov);
        setRemotes(rem);
        setStep(rem.length > 0 ? 'remotes' : 'addRemote');
      } catch (err) {
        if (!cancelled) setLoadError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pickRemote = (name: string) => {
    setRemoteName(name);
    setRemotePathDraft('');
    setStep('path');
  };

  const handleRemoteAdded = async (added: { name: string }) => {
    setRemoteName(added.name);
    setRemotePathDraft('');
    // Refreshed so the "Back" step from here on has an accurate remote list to return to (this
    // one included) rather than the stale pre-add snapshot.
    await rcloneApi
      .getRemotes()
      .then(setRemotes)
      .catch(() => {});
    setStep('path');
  };

  if (step === 'browse' && remoteName) {
    return <RestoreFromRemoteWizard onClose={onClose} onRestored={onRestored} focusCategory={focusCategory} browsePath={{ remoteName, remotePath: remotePathDraft.trim() }} onBack={() => setStep('path')} />;
  }

  const title = focusCategory === 'array' ? 'Recover the array from a remote backup' : 'Restore from a remote backup';

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog import-array-wizard">
        <div className="dialog__head">
          <div className="dialog__title">{title}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          {loadError && (
            <>
              <div className="status-note status-note--error">{loadError}</div>
              <div className="dialog__actions">
                <button type="button" className="btn" onClick={onClose}>
                  Cancel
                </button>
              </div>
            </>
          )}

          {!loadError && step === 'loading' && <div className="status-note">Turning on Remote Backup…</div>}

          {!loadError && step === 'remotes' && (
            <>
              <div className="toggle-row__desc">Pick a remote to browse for backups already sitting on it, or connect a new one.</div>
              <div className="import-browser__list">
                {remotes.map((r) => (
                  <button type="button" key={r.name} className="import-browser__row" onClick={() => pickRemote(r.name)}>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                    <span style={{ flexShrink: 0, color: 'var(--color-text-dim)' }}>{r.type}</span>
                  </button>
                ))}
              </div>
              <div className="dialog__actions">
                <button type="button" className="btn" onClick={() => setStep('addRemote')}>
                  + Add a different remote
                </button>
                <button type="button" className="btn" onClick={onClose}>
                  Cancel
                </button>
              </div>
            </>
          )}

          {!loadError && step === 'addRemote' && (
            <AddRemoteForm providers={providers} onAdded={handleRemoteAdded} onCancel={() => (remotes.length > 0 ? setStep('remotes') : onClose())} title="Connect a remote" />
          )}

          {!loadError && step === 'path' && remoteName && (
            <>
              <div className="toggle-row__desc">
                Where on <strong>{remoteName}</strong> did the old install's sync job point? Leave blank to browse the remote's own root.
              </div>
              <label className="field">
                <span>Remote path (optional)</span>
                <input className="history-input" value={remotePathDraft} onChange={(e) => setRemotePathDraft(e.target.value)} placeholder="bucket/subfolder" autoFocus />
              </label>
              <div className="dialog__actions">
                <button type="button" className="btn" onClick={() => setStep(remotes.length > 0 ? 'remotes' : 'addRemote')}>
                  Back
                </button>
                <button type="button" className="btn btn--primary-sm" onClick={() => setStep('browse')}>
                  Browse backups
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
