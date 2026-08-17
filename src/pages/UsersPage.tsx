import { useState } from 'react';
import { ShareExportModal } from '../components/shares/ShareExportModal';
import { AddUserModal } from '../components/users/AddUserModal';
import { GroupsModal } from '../components/users/GroupsModal';
import { UserDetailPanel } from '../components/users/UserDetailPanel';
import { useGroups } from '../hooks/useGroups';
import { useShares } from '../hooks/useShares';
import { useUsers } from '../hooks/useUsers';
import { deriveShareViewModel } from '../selectors/shares';
import { deriveUserViewModel } from '../selectors/users';
import type { Share } from '../types/sharesApi';

export function UsersPage() {
  const { users, status, error, actionError, pendingUsernames, create, update, remove } = useUsers();
  const groups = useGroups();
  const shares = useShares();
  const [creating, setCreating] = useState(false);
  const [managingGroups, setManagingGroups] = useState(false);
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [exportingShare, setExportingShare] = useState<Share | null>(null);

  const views = users.map(deriveUserViewModel);
  const existingUsernames = users.map((u) => u.username);
  const selectedUser = users.find((u) => u.username === selectedUsername) ?? null;
  const shareViews = shares.shares.map(deriveShareViewModel);

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
        <div className="page-title">Sharing</div>
      </div>

      <div className="eyebrow disk-section-label">Shares</div>
      <div className="toggle-row__desc" style={{ marginBottom: 'var(--space-sm)' }}>
        Turn on SMB or NFS access for a pool (created on the Pools tab), and grant per-user permissions below.
      </div>

      {shares.status === 'loading' && <div className="status-note">Loading pools…</div>}
      {shares.error && <div className="status-note status-note--error">{shares.error}</div>}
      {shares.actionError && <div className="status-note status-note--error">{shares.actionError}</div>}

      <div className="list" style={{ marginBottom: 'var(--space-lg)' }}>
        {shareViews.map((share) => (
          <div className="list-card" key={share.name}>
            <div className="list-card__col--name">
              <div className="list-card__title">{share.name}</div>
              <div className="list-card__subtitle">{share.protocolLabel}</div>
            </div>
            <div className="list-card__col--wide">{share.accessLabel}</div>
            <div className="list-card__actions">
              <button
                type="button"
                className="btn"
                disabled={shares.pendingNames.has(share.name)}
                onClick={() => setExportingShare(shares.shares.find((s) => s.name === share.name) ?? null)}
              >
                Configure Sharing
              </button>
            </div>
          </div>
        ))}
        {shares.status === 'ready' && shareViews.length === 0 && (
          <div className="status-note">No pools yet - create one from the Pools tab first.</div>
        )}
      </div>

      <div className="eyebrow disk-section-label">Users</div>
      <div className="page-header">
        <div />
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

      {exportingShare && (
        <ShareExportModal
          share={exportingShare}
          onCancel={() => setExportingShare(null)}
          onSubmit={async (input) => {
            const ok = await shares.update(exportingShare.name, input);
            if (ok) setExportingShare(null);
            return ok;
          }}
        />
      )}

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
