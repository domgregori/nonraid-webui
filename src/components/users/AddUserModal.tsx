import { useState } from 'react';
import type { UserInput } from '../../types/usersApi';

interface AddUserModalProps {
  existingUsernames: string[];
  onCancel: () => void;
  onSubmit: (input: UserInput) => Promise<boolean>;
}

const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const MIN_PASSWORD_LENGTH = 8;

export function AddUserModal({ existingUsernames, onCancel, onSubmit }: AddUserModalProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const validate = (): string | null => {
    if (!USERNAME_RE.test(username)) {
      return 'Username must be lowercase letters, numbers, dash, underscore - starting with a letter or underscore.';
    }
    if (existingUsernames.includes(username)) return `User "${username}" already exists.`;
    if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (password !== confirmPassword) return 'Passwords do not match.';
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
    const ok = await onSubmit({ username, password, groups: [] });
    setSubmitting(false);
    if (!ok) setError('Request failed - see the page error banner for details.');
  };

  return (
    <>
      <div className="detail-overlay" onClick={onCancel} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">Add User</div>
          <button type="button" className="detail-panel__close" onClick={onCancel} aria-label="Close">
            &#10005;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="dialog__body">
          <label className="form-field">
            <span className="form-field__label">Username</span>
            <input
              className="history-input"
              style={{ width: '100%' }}
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              placeholder="jsmith"
              autoFocus
            />
          </label>

          <label className="form-field">
            <span className="form-field__label">Password</span>
            <input
              type="password"
              className="history-input"
              style={{ width: '100%' }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <label className="form-field">
            <span className="form-field__label">Confirm password</span>
            <input
              type="password"
              className="history-input"
              style={{ width: '100%' }}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>

          <div className="status-note">Share access and groups can be set from the user's page after they're created.</div>

          {error && <div className="status-note status-note--error">{error}</div>}

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn--primary" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
