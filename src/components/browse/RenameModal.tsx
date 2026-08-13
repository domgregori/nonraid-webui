import { useState } from 'react';
import type { BrowseEntry } from '../../types/browseApi';

interface RenameModalProps {
  entry: BrowseEntry;
  onCancel: () => void;
  onSubmit: (newName: string) => Promise<boolean>;
}

export function RenameModal({ entry, onCancel, onSubmit }: RenameModalProps) {
  const [name, setName] = useState(entry.name);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
      setError('Enter a valid name - no slashes.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const ok = await onSubmit(name);
    setSubmitting(false);
    if (!ok) setError('Rename failed - see the page error banner for details.');
  };

  return (
    <>
      <div className="detail-overlay" onClick={onCancel} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">Rename {entry.name}</div>
          <button type="button" className="detail-panel__close" onClick={onCancel} aria-label="Close">
            &#10005;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="dialog__body">
          <label className="form-field">
            <span className="form-field__label">New name</span>
            <input
              className="history-input"
              style={{ width: '100%' }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </label>

          {error && <div className="status-note status-note--error">{error}</div>}

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn--primary" disabled={submitting}>
              {submitting ? 'Renaming…' : 'Rename'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
