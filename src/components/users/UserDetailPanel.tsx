import { useEffect, useState } from 'react';
import { usersApi } from '../../api/usersApi';
import { PERMISSION_LABELS } from '../../selectors/users';
import type { Group, ShareAccessEntry, SharePermission, User } from '../../types/usersApi';

const MIN_PASSWORD_LENGTH = 8;
const PERMISSIONS: SharePermission[] = ['read-write', 'read-only', 'none', 'hidden'];

interface UserDetailPanelProps {
  user: User;
  groups: Group[];
  pending: boolean;
  onClose: () => void;
  onUpdateGroups: (groups: string[]) => Promise<boolean>;
  onResetPassword: (password: string) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}

export function UserDetailPanel({ user, groups, pending, onClose, onUpdateGroups, onResetPassword, onDelete }: UserDetailPanelProps) {
  const [access, setAccess] = useState<ShareAccessEntry[] | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [savingShare, setSavingShare] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordNote, setPasswordNote] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAccess(null);
    usersApi
      .getAccess(user.username)
      .then((entries) => {
        if (!cancelled) setAccess(entries);
      })
      .catch((err) => {
        if (!cancelled) setAccessError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [user.username]);

  const toggleGroup = (name: string) => {
    const next = user.groups.includes(name) ? user.groups.filter((g) => g !== name) : [...user.groups, name];
    onUpdateGroups(next);
  };

  const handleAccessChange = async (shareName: string, permission: SharePermission) => {
    setSavingShare(shareName);
    setAccessError(null);
    try {
      await usersApi.setAccess(user.username, shareName, permission);
      setAccess((prev) => (prev ? prev.map((e) => (e.shareName === shareName ? { ...e, permission } : e)) : prev));
    } catch (err) {
      setAccessError((err as Error).message);
    } finally {
      setSavingShare(null);
    }
  };

  const handleResetPassword = async () => {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setPasswordNote(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirmPassword) {
      setPasswordNote('Passwords do not match.');
      return;
    }
    const ok = await onResetPassword(password);
    setPasswordNote(ok ? 'Password updated.' : 'Failed to update password.');
    if (ok) {
      setPassword('');
      setConfirmPassword('');
    }
  };

  const handleDeleteClick = () => {
    if (confirmingDelete) {
      onDelete();
    } else {
      setConfirmingDelete(true);
    }
  };

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="detail-panel">
        <div className="detail-panel__head">
          <div className="detail-panel__title">{user.username}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <div className="detail-panel__body">
          <div className="detail-card">
            <div className="eyebrow">Info</div>
            <div className="detail-rows">
              <div className="detail-row">
                <span className="detail-row__label">UID</span>
                <span className="detail-row__value">{user.uid}</span>
              </div>
            </div>
          </div>

          <div className="detail-card">
            <div className="eyebrow">Groups</div>
            {groups.length === 0 && <div className="status-note">No groups yet — create one from the Groups panel.</div>}
            <div className="disk-checkbox-grid">
              {groups.map((g) => (
                <label key={g.name} className="disk-checkbox">
                  <input type="checkbox" checked={user.groups.includes(g.name)} disabled={pending} onChange={() => toggleGroup(g.name)} />
                  {g.name}
                </label>
              ))}
            </div>
          </div>

          <div className="detail-card">
            <div className="eyebrow">Share access</div>
            {accessError && <div className="status-note status-note--error">{accessError}</div>}
            {access === null && !accessError && <div className="status-note">Loading…</div>}
            {access !== null && access.length === 0 && <div className="status-note">No shares exist yet.</div>}
            <div className="access-rows">
              {access?.map((entry) => (
                <div className="access-row" key={entry.shareName}>
                  <span className="access-row__name">{entry.shareName}</span>
                  <select
                    className="history-input"
                    value={entry.permission}
                    disabled={savingShare === entry.shareName}
                    onChange={(e) => handleAccessChange(entry.shareName, e.target.value as SharePermission)}
                  >
                    {PERMISSIONS.map((p) => (
                      <option key={p} value={p}>
                        {PERMISSION_LABELS[p]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="detail-card">
            <div className="eyebrow">Reset password</div>
            <div className="form-field">
              <input
                type="password"
                className="history-input"
                style={{ width: '100%' }}
                placeholder="New password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="form-field">
              <input
                type="password"
                className="history-input"
                style={{ width: '100%' }}
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            {passwordNote && <div className="status-note">{passwordNote}</div>}
            <button type="button" className="btn btn--block" disabled={pending} onClick={handleResetPassword}>
              {pending ? 'Saving…' : 'Reset Password'}
            </button>
          </div>
        </div>

        <div className="detail-actions">
          <button type="button" className="btn btn--block btn--danger" disabled={pending} onClick={handleDeleteClick}>
            {confirmingDelete ? 'Confirm Remove User?' : 'Remove User'}
          </button>
        </div>
      </div>
    </>
  );
}
