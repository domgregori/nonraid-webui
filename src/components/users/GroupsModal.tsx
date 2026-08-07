import { useEffect, useState } from 'react';
import { groupsApi } from '../../api/usersApi';
import type { UseGroups } from '../../hooks/useGroups';
import { PERMISSION_LABELS } from '../../selectors/users';
import type { ShareAccessEntry, SharePermission } from '../../types/usersApi';

const GROUP_NAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const PERMISSIONS: SharePermission[] = ['read-write', 'read-only', 'none', 'hidden'];

interface GroupsModalProps {
  groups: UseGroups;
  onClose: () => void;
}

export function GroupsModal({ groups, onClose }: GroupsModalProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);
  const [access, setAccess] = useState<ShareAccessEntry[] | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [savingShare, setSavingShare] = useState<string | null>(null);

  useEffect(() => {
    if (!expandedGroup) return;
    let cancelled = false;
    setAccess(null);
    setAccessError(null);
    groupsApi
      .getAccess(expandedGroup)
      .then((entries) => {
        if (!cancelled) setAccess(entries);
      })
      .catch((err) => {
        if (!cancelled) setAccessError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [expandedGroup]);

  const toggleExpanded = (groupName: string) => {
    setExpandedGroup((prev) => (prev === groupName ? null : groupName));
  };

  const handleAccessChange = async (shareName: string, permission: SharePermission) => {
    if (!expandedGroup) return;
    setSavingShare(shareName);
    setAccessError(null);
    try {
      await groupsApi.setAccess(expandedGroup, shareName, permission);
      setAccess((prev) => (prev ? prev.map((e) => (e.shareName === shareName ? { ...e, permission } : e)) : prev));
    } catch (err) {
      setAccessError((err as Error).message);
    } finally {
      setSavingShare(null);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!GROUP_NAME_RE.test(name)) {
      setError('Group name must be lowercase letters, numbers, dash, underscore — starting with a letter or underscore.');
      return;
    }
    if (groups.groups.some((g) => g.name === name)) {
      setError(`Group "${name}" already exists.`);
      return;
    }
    setError(null);
    const ok = await groups.create({ name });
    if (ok) setName('');
  };

  const handleDeleteClick = (groupName: string) => {
    if (confirmingDelete === groupName) {
      groups.remove(groupName);
      setConfirmingDelete(null);
    } else {
      setConfirmingDelete(groupName);
    }
  };

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">Groups</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          <div className="access-rows">
            {groups.groups.map((g) => (
              <div key={g.name}>
                <div className="access-row">
                  <span className="access-row__name">{g.name}</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" className="btn" onClick={() => toggleExpanded(g.name)}>
                      {expandedGroup === g.name ? 'Hide access' : 'Share access'}
                    </button>
                    <button
                      type="button"
                      className="btn btn--danger"
                      disabled={groups.pendingNames.has(g.name)}
                      onClick={() => handleDeleteClick(g.name)}
                    >
                      {confirmingDelete === g.name ? 'Confirm?' : 'Remove'}
                    </button>
                  </div>
                </div>

                {expandedGroup === g.name && (
                  <div style={{ marginTop: 8, marginLeft: 12 }}>
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
                )}
              </div>
            ))}
            {groups.status === 'ready' && groups.groups.length === 0 && <div className="status-note">No groups yet.</div>}
          </div>

          <form onSubmit={handleAdd} className="form-field">
            <span className="form-field__label">New group</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="history-input"
                style={{ flex: 1 }}
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase())}
                placeholder="media-users"
              />
              <button type="submit" className="btn--primary">
                Add
              </button>
            </div>
          </form>

          {error && <div className="status-note status-note--error">{error}</div>}
          {groups.actionError && <div className="status-note status-note--error">{groups.actionError}</div>}
        </div>
      </div>
    </>
  );
}
