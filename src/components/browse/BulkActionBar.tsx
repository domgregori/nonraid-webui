import { useState } from 'react';

interface BulkActionBarProps {
  count: number;
  onClear: () => void;
  onCopy: () => void;
  onMove: () => void;
  onDelete: () => void;
}

/** Replaces the normal New Folder/Upload toolbar row whenever there's an active selection -
 *  reads as "you're in selection mode" rather than just another static toolbar. */
export function BulkActionBar({ count, onClear, onCopy, onMove, onDelete }: BulkActionBarProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleDeleteClick = () => {
    if (confirmingDelete) {
      setConfirmingDelete(false);
      onDelete();
    } else {
      setConfirmingDelete(true);
    }
  };

  return (
    <div className="browse-bulk-bar">
      <span className="browse-bulk-bar__count">{count} selected</span>
      <button type="button" className="btn" onClick={onCopy}>
        Copy
      </button>
      <button type="button" className="btn" onClick={onMove}>
        Move
      </button>
      <button type="button" className="btn btn--danger" onClick={handleDeleteClick}>
        {confirmingDelete ? 'Confirm?' : 'Delete'}
      </button>
      <button type="button" className="btn" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}
