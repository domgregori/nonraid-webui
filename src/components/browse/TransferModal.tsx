import { useState } from 'react';
import { PathAutocomplete } from '../shared/PathAutocomplete';
import type { BrowseEntry } from '../../types/browseApi';

interface TransferModalProps {
  op: 'copy' | 'move';
  /** Length 1 for a single-row action, N for a multi-select bulk action. */
  entries: BrowseEntry[];
  currentPath: string;
  onCancel: () => void;
  // Just collects the destination and hands off — the actual transfer is async, tracked by
  // bulkJob/BulkProgressDialog rather than this modal's own submitting/error state.
  onStart: (destPath: string) => void;
}

const VERB: Record<'copy' | 'move', string> = { copy: 'Copy', move: 'Move' };

export function TransferModal({ op, entries, currentPath, onCancel, onStart }: TransferModalProps) {
  const [destPath, setDestPath] = useState(currentPath);
  const verb = VERB[op];
  const label = entries.length === 1 ? entries[0]!.name : `${entries.length} items`;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onStart(destPath.trim().replace(/\/+$/, ''));
  };

  return (
    <>
      <div className="detail-overlay" onClick={onCancel} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">
            {verb} {label}
          </div>
          <button type="button" className="detail-panel__close" onClick={onCancel} aria-label="Close">
            &#10005;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="dialog__body">
          <label className="form-field">
            <span className="form-field__label">Destination folder (absolute path under /mnt)</span>
            <PathAutocomplete
              scope="browse"
              value={destPath}
              onChange={setDestPath}
              placeholder="e.g. /mnt/user/photos/2024"
              autoFocus
            />
          </label>

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn--primary">
              {verb}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
