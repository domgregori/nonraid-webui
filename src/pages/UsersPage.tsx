import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShareExportModal } from '../components/shares/ShareExportModal';
import { AddGroupModal } from '../components/users/AddGroupModal';
import { AddUserModal } from '../components/users/AddUserModal';
import { GroupDetailPanel } from '../components/users/GroupDetailPanel';
import { PendingImportUsersSection } from '../components/users/PendingImportUsersSection';
import { UserDetailPanel } from '../components/users/UserDetailPanel';
import { useGroups } from '../hooks/useGroups';
import { useShares } from '../hooks/useShares';
import { useUsers } from '../hooks/useUsers';
import { deriveShareViewModel } from '../selectors/shares';
import { deriveUserViewModel } from '../selectors/users';
import type { Share } from '../types/sharesApi';

export function UsersPage() {
  const { t } = useTranslation('pages');
  const { users, status, error, actionError, pendingUsernames, create, update, remove } = useUsers();
  const groups = useGroups();
  const shares = useShares();
  const [creating, setCreating] = useState(false);
  const [addingGroup, setAddingGroup] = useState(false);
  const [selectedUsername, setSelectedUsername] = useState<string | null>(null);
  const [selectedGroupName, setSelectedGroupName] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [confirmingGroupDelete, setConfirmingGroupDelete] = useState<string | null>(null);
  const [exportingShare, setExportingShare] = useState<Share | null>(null);

  const views = users.map(deriveUserViewModel);
  const existingUsernames = users.map((u) => u.username);
  const existingGroupNames = groups.groups.map((g) => g.name);
  const selectedUser = users.find((u) => u.username === selectedUsername) ?? null;
  const selectedGroup = groups.groups.find((g) => g.name === selectedGroupName) ?? null;
  const shareViews = shares.shares.map(deriveShareViewModel);

  const handleDeleteClick = (username: string) => {
    if (confirmingDelete === username) {
      remove(username);
      setConfirmingDelete(null);
    } else {
      setConfirmingDelete(username);
    }
  };

  const handleGroupDeleteClick = (name: string) => {
    if (confirmingGroupDelete === name) {
      groups.remove(name);
      setConfirmingGroupDelete(null);
    } else {
      setConfirmingGroupDelete(name);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">{t('UsersPage.title')}</div>
      </div>

      <div className="eyebrow disk-section-label">{t('UsersPage.sharesHeading')}</div>
      <div className="toggle-row__desc" style={{ marginBottom: 'var(--space-sm)' }}>
        {t('UsersPage.sharesDesc')}
      </div>

      {shares.status === 'loading' && <div className="status-note">{t('UsersPage.loadingPools')}</div>}
      {shares.error && <div className="status-note status-note--error">{shares.error}</div>}
      {shares.actionError && <div className="status-note status-note--error">{shares.actionError}</div>}

      <div className="list" style={{ marginBottom: 'var(--space-lg)' }}>
        {shareViews.map((share) => (
          <div className="list-card" key={share.name}>
            <div className="list-card__col--name">
              <div className="list-card__title">{share.name}</div>
              <div className="list-card__subtitle">{share.protocolLabel}</div>
            </div>
            <div className="list-card__col--wide">
              {share.accessLabel}
              {share.endpoints.length > 0 && (
                <div className="list-card__endpoints">
                  {share.endpoints.map((ep) => (
                    <div className="list-card__endpoint" key={ep}>
                      {ep}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="list-card__actions">
              <button
                type="button"
                className="btn"
                disabled={shares.pendingNames.has(share.name)}
                onClick={() => setExportingShare(shares.shares.find((s) => s.name === share.name) ?? null)}
              >
                {t('UsersPage.configureSharing')}
              </button>
            </div>
          </div>
        ))}
        {shares.status === 'ready' && shareViews.length === 0 && (
          <div className="status-note">{t('UsersPage.noPools')}</div>
        )}
      </div>

      <PendingImportUsersSection />

      <div className="eyebrow disk-section-label">{t('UsersPage.usersHeading')}</div>
      <div className="page-header">
        <div />
        <button type="button" className="btn--primary" onClick={() => setCreating(true)}>
          {t('UsersPage.addUser')}
        </button>
      </div>

      {status === 'loading' && <div className="status-note">{t('UsersPage.loadingUsers')}</div>}
      {error && <div className="status-note status-note--error">{error}</div>}
      {actionError && <div className="status-note status-note--error">{actionError}</div>}

      <div className="list">
        {views.map((u) => (
          <div className="list-card" key={u.username}>
            <div className="avatar">{u.initial}</div>
            <div className="list-card__col--name">
              <div className="list-card__title">{u.username}</div>
              <div className="list-card__subtitle">{t('UsersPage.uidLabel', { uid: u.uid })}</div>
            </div>
            <div className="list-card__col--wide">{u.groupsLabel}</div>
            <div className="list-card__actions">
              <button type="button" className="btn" disabled={pendingUsernames.has(u.username)} onClick={() => setSelectedUsername(u.username)}>
                {t('UsersPage.manage')}
              </button>
              <button
                type="button"
                className="btn btn--danger"
                disabled={pendingUsernames.has(u.username)}
                onClick={() => handleDeleteClick(u.username)}
              >
                {confirmingDelete === u.username ? t('UsersPage.confirmQuestion') : t('UsersPage.remove')}
              </button>
            </div>
          </div>
        ))}
        {status === 'ready' && views.length === 0 && <div className="status-note">{t('UsersPage.noUsers')}</div>}
      </div>

      <div className="eyebrow disk-section-label">{t('UsersPage.groupsHeading')}</div>
      <div className="page-header">
        <div />
        <button type="button" className="btn--primary" onClick={() => setAddingGroup(true)}>
          {t('UsersPage.addGroup')}
        </button>
      </div>

      {groups.status === 'loading' && <div className="status-note">{t('UsersPage.loadingGroups')}</div>}
      {groups.error && <div className="status-note status-note--error">{groups.error}</div>}
      {groups.actionError && <div className="status-note status-note--error">{groups.actionError}</div>}

      <div className="list">
        {groups.groups.map((g) => {
          const memberNames = users.filter((u) => u.groups.includes(g.name)).map((u) => u.username);
          return (
            <div className="list-card" key={g.name}>
              <div className="avatar">{g.name[0]?.toUpperCase()}</div>
              <div className="list-card__col--name">
                <div className="list-card__title">{g.name}</div>
                <div className="list-card__subtitle">{t('UsersPage.gidLabel', { gid: g.gid })}</div>
              </div>
              <div className="list-card__col--wide">{memberNames.length > 0 ? memberNames.join(', ') : t('UsersPage.noMembers')}</div>
              <div className="list-card__actions">
                <button type="button" className="btn" disabled={groups.pendingNames.has(g.name)} onClick={() => setSelectedGroupName(g.name)}>
                  {t('UsersPage.manage')}
                </button>
                <button
                  type="button"
                  className="btn btn--danger"
                  disabled={groups.pendingNames.has(g.name)}
                  onClick={() => handleGroupDeleteClick(g.name)}
                >
                  {confirmingGroupDelete === g.name ? t('UsersPage.confirmQuestion') : t('UsersPage.remove')}
                </button>
              </div>
            </div>
          );
        })}
        {groups.status === 'ready' && groups.groups.length === 0 && <div className="status-note">{t('UsersPage.noGroups')}</div>}
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

      {addingGroup && (
        <AddGroupModal
          existingGroupNames={existingGroupNames}
          onCancel={() => setAddingGroup(false)}
          onSubmit={async (input) => {
            const ok = await groups.create(input);
            if (ok) setAddingGroup(false);
            return ok;
          }}
        />
      )}

      {selectedGroup && (
        <GroupDetailPanel
          group={selectedGroup}
          users={users}
          pending={groups.pendingNames.has(selectedGroup.name)}
          onClose={() => setSelectedGroupName(null)}
          onDelete={async () => {
            const ok = await groups.remove(selectedGroup.name);
            if (ok) setSelectedGroupName(null);
            return ok;
          }}
        />
      )}

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
