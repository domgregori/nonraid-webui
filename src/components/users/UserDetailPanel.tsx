import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

/** Order-independent - group order in either array reflects fetch/toggle history, not intent. */
function sameGroups(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sorted = [...b].sort();
  return [...a].sort().every((g, i) => g === sorted[i]);
}

export function UserDetailPanel({ user, groups, pending, onClose, onUpdateGroups, onResetPassword, onDelete }: UserDetailPanelProps) {
  const { t } = useTranslation('users');
  // `access` is the last-saved baseline (what the system actually has); `draftAccess` is what's
  // shown/edited - nothing here reaches the server until Save is pressed, same as `draftGroups`
  // below. Both reset to the freshly-fetched baseline on load/user switch.
  const [access, setAccess] = useState<ShareAccessEntry[] | null>(null);
  const [draftAccess, setDraftAccess] = useState<ShareAccessEntry[] | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [draftGroups, setDraftGroups] = useState<string[]>(user.groups);
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordNote, setPasswordNote] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAccess(null);
    setDraftAccess(null);
    usersApi
      .getAccess(user.username)
      .then((entries) => {
        if (!cancelled) {
          setAccess(entries);
          setDraftAccess(entries);
        }
      })
      .catch((err) => {
        if (!cancelled) setAccessError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [user.username]);

  useEffect(() => {
    setDraftGroups(user.groups);
  }, [user.username, user.groups]);

  const toggleGroup = (name: string) => {
    setDraftGroups((prev) => (prev.includes(name) ? prev.filter((g) => g !== name) : [...prev, name]));
  };

  const handleAccessChange = (shareName: string, permission: SharePermission) => {
    setDraftAccess((prev) => (prev ? prev.map((e) => (e.shareName === shareName ? { ...e, permission } : e)) : prev));
  };

  const groupsDirty = !sameGroups(draftGroups, user.groups);
  const changedAccess = (draftAccess ?? []).filter((entry) => access?.find((a) => a.shareName === entry.shareName)?.permission !== entry.permission);
  const dirty = groupsDirty || changedAccess.length > 0;

  const handleSave = async () => {
    setSaving(true);
    setAccessError(null);
    setSaveNote(null);
    try {
      if (groupsDirty) {
        const ok = await onUpdateGroups(draftGroups);
        if (!ok) throw new Error(t('UserDetailPanel.updateGroupsFailed'));
      }
      for (const entry of changedAccess) {
        await usersApi.setAccess(user.username, entry.shareName, entry.permission);
      }
      if (changedAccess.length > 0) setAccess(draftAccess);
      setSaveNote(t('UserDetailPanel.changesSaved'));
    } catch (err) {
      setAccessError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async () => {
    if (password.length < MIN_PASSWORD_LENGTH) {
      setPasswordNote(t('UserDetailPanel.passwordTooShort', { minLength: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (password !== confirmPassword) {
      setPasswordNote(t('UserDetailPanel.passwordsDontMatch'));
      return;
    }
    const ok = await onResetPassword(password);
    setPasswordNote(ok ? t('UserDetailPanel.passwordUpdated') : t('UserDetailPanel.passwordUpdateFailed'));
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
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('UserDetailPanel.close')}>
            &#10005;
          </button>
        </div>

        <div className="detail-panel__body">
          <div className="detail-card">
            <div className="eyebrow">{t('UserDetailPanel.info')}</div>
            <div className="detail-rows">
              <div className="detail-row">
                <span className="detail-row__label">{t('UserDetailPanel.uid')}</span>
                <span className="detail-row__value">{user.uid}</span>
              </div>
            </div>
          </div>

          <div className="detail-card">
            <div className="eyebrow">{t('UserDetailPanel.groups')}</div>
            {groups.length === 0 && <div className="status-note">{t('UserDetailPanel.noGroups')}</div>}
            <div className="disk-checkbox-grid">
              {groups.map((g) => (
                <label key={g.name} className="disk-checkbox">
                  <input type="checkbox" checked={draftGroups.includes(g.name)} disabled={pending || saving} onChange={() => toggleGroup(g.name)} />
                  {g.name}
                </label>
              ))}
            </div>
          </div>

          <div className="detail-card">
            <div className="eyebrow">{t('UserDetailPanel.shareAccess')}</div>
            {accessError && <div className="status-note status-note--error">{accessError}</div>}
            {access === null && !accessError && <div className="status-note">{t('UserDetailPanel.loading')}</div>}
            {access !== null && access.length === 0 && <div className="status-note">{t('UserDetailPanel.noShares')}</div>}
            <div className="access-rows">
              {draftAccess?.map((entry) => (
                <div className="access-row" key={entry.shareName}>
                  <span className="access-row__name">{entry.shareName}</span>
                  <select
                    className="history-input"
                    value={entry.permission}
                    disabled={saving}
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

          {saveNote && <div className="status-note">{saveNote}</div>}
          <button type="button" className="btn btn--primary btn--block" disabled={!dirty || saving || pending} onClick={handleSave}>
            {saving ? t('UserDetailPanel.saving') : dirty ? t('UserDetailPanel.saveChanges') : t('UserDetailPanel.noChanges')}
          </button>

          <div className="detail-card">
            <div className="eyebrow">{t('UserDetailPanel.resetPassword')}</div>
            <div className="form-field">
              <input
                type="password"
                className="history-input"
                style={{ width: '100%' }}
                placeholder={t('UserDetailPanel.newPasswordPlaceholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="form-field">
              <input
                type="password"
                className="history-input"
                style={{ width: '100%' }}
                placeholder={t('UserDetailPanel.confirmNewPasswordPlaceholder')}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            {passwordNote && <div className="status-note">{passwordNote}</div>}
            <button type="button" className="btn btn--block" disabled={pending} onClick={handleResetPassword}>
              {pending ? t('UserDetailPanel.saving') : t('UserDetailPanel.resetPasswordButton')}
            </button>
          </div>
        </div>

        <div className="detail-actions">
          <button type="button" className="btn btn--block btn--danger" disabled={pending} onClick={handleDeleteClick}>
            {confirmingDelete ? t('UserDetailPanel.confirmRemove') : t('UserDetailPanel.removeUser')}
          </button>
        </div>
      </div>
    </>
  );
}
