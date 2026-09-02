import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePendingImportUsers } from '../../hooks/usePendingImportUsers';

/**
 * Users found by "Import from Unraid" (Settings), parked here until a real password is chosen for
 * each one - see PendingImportUsersStore's own doc comment for why user creation never happens
 * automatically the way share creation does. Renders nothing at all once the queue is empty, so it
 * never sits around as a permanent empty section on a page that's never run that import.
 */
export function PendingImportUsersSection() {
  const { t } = useTranslation('pages');
  const { pending, status, actionError, pendingUsernames, create, discard } = usePendingImportUsers();
  const [passwords, setPasswords] = useState<Record<string, string>>({});

  if (status !== 'ready' || pending.length === 0) return null;

  return (
    <>
      <div className="eyebrow disk-section-label">{t('UsersPage.pendingImportHeading')}</div>
      <div className="toggle-row__desc" style={{ marginBottom: 'var(--space-sm)' }}>
        {t('UsersPage.pendingImportDesc')}
      </div>
      {actionError && <div className="status-note status-note--error">{actionError}</div>}

      <div className="list" style={{ marginBottom: 'var(--space-lg)' }}>
        {pending.map((u) => {
          const shareCount = new Set([...u.readShares, ...u.writeShares]).size;
          const isPending = pendingUsernames.has(u.username);
          return (
            <div className="list-card" key={u.username}>
              <div className="avatar">{u.username[0]?.toUpperCase()}</div>
              <div className="list-card__col--name">
                <div className="list-card__title">{u.username}</div>
                <div className="list-card__subtitle">{t('UsersPage.pendingImportShareCount', { count: shareCount })}</div>
              </div>
              <div className="list-card__col--wide">
                <input
                  type="password"
                  className="history-input"
                  placeholder={t('UsersPage.pendingImportPasswordPlaceholder')}
                  value={passwords[u.username] ?? ''}
                  onChange={(e) => setPasswords((prev) => ({ ...prev, [u.username]: e.target.value }))}
                  disabled={isPending}
                />
              </div>
              <div className="list-card__actions">
                <button
                  type="button"
                  className="btn--primary"
                  disabled={isPending || !passwords[u.username]}
                  onClick={async () => {
                    const ok = await create(u.username, passwords[u.username]!);
                    if (ok) setPasswords((prev) => { const next = { ...prev }; delete next[u.username]; return next; });
                  }}
                >
                  {t('UsersPage.pendingImportAdd')}
                </button>
                <button type="button" className="btn btn--danger" disabled={isPending} onClick={() => discard(u.username)}>
                  {t('UsersPage.remove')}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
