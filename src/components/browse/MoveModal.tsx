import { useState } from 'react';
import type { BrowseEntry } from '../../types/browseApi';

interface MoveModalProps {
  entry: BrowseEntry;
  shareLabel: string;
  onCancel: () => void;
  onSubmit: (destPath: string) => Promise<boolean>;
}

export function MoveModal({ entry, shareLabel, onCancel, onSubmit }: MoveModalProps) {
  const [destPath, setDestPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const ok = await onSubmit(destPath.replace(/^\/+/, '').replace(/\/+$/, ''));
    setSubmitting(false);
    if (!ok) setError('Move failed — see the page error banner for details.');
  };

  return (
    <>
      <div className="detail-overlay" onClick={onCancel} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">Move {entry.name}</div>
          <button type="button" className="detail-panel__close" onClick={onCancel} aria-label="Close">
            &#10005;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="dialog__body">
          <label className="form-field">
            <span className="form-field__label">Destination folder in {shareLabel}</span>
            <input
              className="history-input"
              style={{ width: '100%' }}
              value={destPath}
              onChange={(e) => setDestPath(e.target.value)}
              placeholder="e.g. photos/2024 — leave blank for the share root"
              autoFocus
            />
          </label>

          {error && <div className="status-note status-note--error">{error}</div>}

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn--primary" disabled={submitting}>
              {submitting ? 'Moving…' : 'Move'}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
