import { useState } from 'react';
import { AddUserModal } from '../components/users/AddUserModal';
import { GroupsModal } from '../components/users/GroupsModal';
import { UserDetailPanel } from '../components/users/UserDetailPanel';
import { useGroups } from '../hooks/useGroups';
import { useUsers } from '../hooks/useUsers';
import { deriveUserViewModel } from '../selectors/users';

export function UsersPage() {
  const { users, status, error, actionError, pendingUsernames, create, update, remove } = useUsers();
  const groups = useGroups();
  const [creating, setCreating] = useState(false);
  const [managingGroups, setManagingGroups] = useState(false);
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const views = users.map(deriveUserViewModel);
  const existingUsernames = users.map((u) => u.username);
  const selectedUser = users.find((u) => u.username === selectedUsername) ?? null;

  const handleDeleteClick = (username: string) => {
    if (confirmingDelete === username) {
      remove(username);
      setConfirmingDelete(null);
    } else {
      setConfirmingDelete(username);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">Users</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn" onClick={() => setManagingGroups(true)}>
            Groups
          </button>
          <button type="button" className="btn--primary" onClick={() => setCreating(true)}>
            Add User
          </button>
        </div>
      </div>

      {status === 'loading' && <div className="status-note">Loading users…</div>}
      {error && <div className="status-note status-note--error">{error}</div>}
      {actionError && <div className="status-note status-note--error">{actionError}</div>}

      <div className="list">
        {views.map((u) => (
          <div className="list-card" key={u.username}>
            <div className="avatar">{u.initial}</div>
            <div className="list-card__col--name">
              <div className="list-card__title">{u.username}</div>
              <div className="list-card__subtitle">uid {u.uid}</div>
            </div>
            <div className="list-card__col--wide">{u.groupsLabel}</div>
            <div className="list-card__actions">
              <button type="button" className="btn" disabled={pendingUsernames.has(u.username)} onClick={() => setSelectedUsername(u.username)}>
                Manage
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={pendingUsernames.has(u.username)}
                onClick={() => handleDeleteClick(u.username)}
              >
                {confirmingDelete === u.username ? 'Confirm?' : 'Remove'}
              </button>
            </div>
          </div>
        ))}
        {status === 'ready' && views.length === 0 && <div className="status-note">No users yet.</div>}
      </div>

      {creating && (
        <AddUserModal
          existingUsernames={existingUsernames}
          onCancel={() => setCreating(false)}
          onSubmit={async (input) => {
            const ok = await create(input);
            if (ok) setCreating(false);
            return ok;
          }}
        />
      )}

      {managingGroups && <GroupsModal groups={groups} onClose={() => setManagingGroups(false)} />}

      {selectedUser && (
        <UserDetailPanel
          user={selectedUser}
          groups={groups.groups}
          pending={pendingUsernames.has(selectedUser.username)}
          onClose={() => setSelectedUsername(null)}
          onUpdateGroups={(nextGroups) => update(selectedUser.username, { groups: nextGroups })}
          onResetPassword={(password) => update(selectedUser.username, { password })}
          onDelete={async () => {
            const ok = await remove(selectedUser.username);
            if (ok) setSelectedUsername(null);
            return ok;
          }}
        />
      )}
    </div>
  );
}
