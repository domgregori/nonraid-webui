import { useEffect, useState } from 'react';
import { groupsApi } from '../../api/usersApi';
import { PERMISSION_LABELS } from '../../selectors/users';
import type { Group, ShareAccessEntry, SharePermission, User } from '../../types/usersApi';

const PERMISSIONS: SharePermission[] = ['read-write', 'read-only', 'none', 'hidden'];

interface GroupDetailPanelProps {
  group: Group;
  /** Every user, so membership can be derived from each User.groups rather than kept as its own
   *  separate source of truth - same "membership lives on the user record" model useUsers/
   *  UserDetailPanel already use for the group side of this same relationship. */
  users: User[];
  pending: boolean;
  onClose: () => void;
  onDelete: () => Promise<boolean>;
}

export function GroupDetailPanel({ group, users, pending, onClose, onDelete }: GroupDetailPanelProps) {
  const [access, setAccess] = useState<ShareAccessEntry[] | null>(null);
  const [draftAccess, setDraftAccess] = useState<ShareAccessEntry[] | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const members = users.filter((u) => u.groups.includes(group.name));

  useEffect(() => {
    let cancelled = false;
    setAccess(null);
    setDraftAccess(null);
    groupsApi
      .getAccess(group.name)
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
  }, [group.name]);

  const handleAccessChange = (shareName: string, permission: SharePermission) => {
    setDraftAccess((prev) => (prev ? prev.map((e) => (e.shareName === shareName ? { ...e, permission } : e)) : prev));
  };

  const changedAccess = (draftAccess ?? []).filter((entry) => access?.find((a) => a.shareName === entry.shareName)?.permission !== entry.permission);
  const dirty = changedAccess.length > 0;

  const handleSave = async () => {
    setSaving(true);
    setAccessError(null);
    setSaveNote(null);
    try {
      for (const entry of changedAccess) {
        await groupsApi.setAccess(group.name, entry.shareName, entry.permission);
      }
      setAccess(draftAccess);
      setSaveNote('Changes saved.');
    } catch (err) {
      setAccessError((err as Error).message);
    } finally {
      setSaving(false);
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
          <div className="detail-panel__title">{group.name}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <div className="detail-panel__body">
          <div className="detail-card">
            <div className="eyebrow">Info</div>
            <div className="detail-rows">
              <div className="detail-row">
                <span className="detail-row__label">GID</span>
                <span className="detail-row__value">{group.gid}</span>
              </div>
            </div>
          </div>

          <div className="detail-card">
            <div className="eyebrow">Members</div>
            {members.length === 0 && <div className="status-note">No users are in this group yet - add it from a user's own page.</div>}
            {members.length > 0 && (
              <div className="detail-rows">
                {members.map((u) => (
                  <div className="detail-row" key={u.username}>
                    <span className="detail-row__label">{u.username}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="detail-card">
            <div className="eyebrow">Share access</div>
            {accessError && <div className="status-note status-note--error">{accessError}</div>}
            {access === null && !accessError && <div className="status-note">Loading…</div>}
            {access !== null && access.length === 0 && <div className="status-note">No shares exist yet.</div>}
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
            {saving ? 'Saving…' : dirty ? 'Save Changes' : 'No Changes'}
          </button>
        </div>

        <div className="detail-actions">
          <button type="button" className="btn btn--block btn--danger" disabled={pending} onClick={handleDeleteClick}>
            {confirmingDelete ? 'Confirm Remove Group?' : 'Remove Group'}
          </button>
        </div>
      </div>
    </>
  );
}
