import { useState } from 'react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation('browse');
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
      <span className="browse-bulk-bar__count">{t('BulkActionBar.selectedCount', { count })}</span>
      <button type="button" className="btn" onClick={onCopy}>
        {t('BulkActionBar.copy')}
      </button>
      <button type="button" className="btn" onClick={onMove}>
        {t('BulkActionBar.move')}
      </button>
      <button type="button" className="btn btn--danger" onClick={handleDeleteClick}>
        {confirmingDelete ? t('BulkActionBar.confirm') : t('BulkActionBar.delete')}
      </button>
      <button type="button" className="btn" onClick={onClear}>
        {t('BulkActionBar.clear')}
      </button>
    </div>
  );
}
