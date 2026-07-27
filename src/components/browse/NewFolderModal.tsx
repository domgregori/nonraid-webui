import { useState } from 'react';

interface NewFolderModalProps {
  onCancel: () => void;
  onSubmit: (name: string) => Promise<boolean>;
}

export function NewFolderModal({ onCancel, onSubmit }: NewFolderModalProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
      setError('Enter a valid folder name — no slashes.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const ok = await onSubmit(name);
    setSubmitting(false);
    if (!ok) setError('Could not create the folder — see the page error banner for details.');
  };

  return (
    <>
      <div className="detail-overlay" onClick={onCancel} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">New Folder</div>
          <button type="button" className="detail-panel__close" onClick={onCancel} aria-label="Close">
            &#10005;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="dialog__body">
          <label className="form-field">
            <span className="form-field__label">Folder name</span>
            <input
              className="history-input"
              style={{ width: '100%' }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="new-folder"
              autoFocus
            />
          </label>

          {error && <div className="status-note status-note--error">{error}</div>}

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn--primary" disabled={submitting}>
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
