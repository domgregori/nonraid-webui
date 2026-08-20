import { useState } from 'react';
import type { GroupInput } from '../../types/usersApi';

interface AddGroupModalProps {
  existingGroupNames: string[];
  onCancel: () => void;
  onSubmit: (input: GroupInput) => Promise<boolean>;
}

const GROUP_NAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;

export function AddGroupModal({ existingGroupNames, onCancel, onSubmit }: AddGroupModalProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const validate = (): string | null => {
    if (!GROUP_NAME_RE.test(name)) {
      return 'Group name must be lowercase letters, numbers, dash, underscore - starting with a letter or underscore.';
    }
    if (existingGroupNames.includes(name)) return `Group "${name}" already exists.`;
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);
    const ok = await onSubmit({ name });
    setSubmitting(false);
    if (!ok) setError('Request failed - see the page error banner for details.');
  };

  return (
    <>
      <div className="detail-overlay" onClick={onCancel} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">Add Group</div>
          <button type="button" className="detail-panel__close" onClick={onCancel} aria-label="Close">
            &#10005;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="dialog__body">
          <label className="form-field">
            <span className="form-field__label">Group name</span>
            <input
              className="history-input"
              style={{ width: '100%' }}
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              placeholder="media-users"
              autoFocus
            />
          </label>

          <div className="status-note">Share access and members can be set from the group's page after it's created.</div>

          {error && <div className="status-note status-note--error">{error}</div>}

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn--primary" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create Group'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
