import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BrowseEntry } from '../../types/browseApi';

interface RenameModalProps {
  entry: BrowseEntry;
  onCancel: () => void;
  onSubmit: (newName: string) => Promise<boolean>;
}

export function RenameModal({ entry, onCancel, onSubmit }: RenameModalProps) {
  const { t } = useTranslation('browse');
  const [name, setName] = useState(entry.name);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
      setError(t('RenameModal.invalidName'));
      return;
    }
    setSubmitting(true);
    setError(null);
    const ok = await onSubmit(name);
    setSubmitting(false);
    if (!ok) setError(t('RenameModal.requestFailed'));
  };

  return (
    <>
      <div className="detail-overlay" onClick={onCancel} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">{t('RenameModal.title', { name: entry.name })}</div>
          <button type="button" className="detail-panel__close" onClick={onCancel} aria-label={t('RenameModal.close')}>
            &#10005;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="dialog__body">
          <label className="form-field">
            <span className="form-field__label">{t('RenameModal.newNameLabel')}</span>
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
              {t('RenameModal.cancel')}
            </button>
            <button type="submit" className="btn--primary" disabled={submitting}>
              {submitting ? t('RenameModal.renaming') : t('RenameModal.rename')}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
