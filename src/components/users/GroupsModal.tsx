import { useState } from 'react';
import type { UseGroups } from '../../hooks/useGroups';

const GROUP_NAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;

interface GroupsModalProps {
  groups: UseGroups;
  onClose: () => void;
}

export function GroupsModal({ groups, onClose }: GroupsModalProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

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
              <div className="access-row" key={g.name}>
                <span className="access-row__name">{g.name}</span>
                <button
                  type="button"
                  className="btn btn--danger"
                  disabled={groups.pendingNames.has(g.name)}
                  onClick={() => handleDeleteClick(g.name)}
                >
                  {confirmingDelete === g.name ? 'Confirm?' : 'Remove'}
                </button>
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
