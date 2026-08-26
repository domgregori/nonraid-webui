import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GroupInput } from '../../types/usersApi';

interface AddGroupModalProps {
  existingGroupNames: string[];
  onCancel: () => void;
  onSubmit: (input: GroupInput) => Promise<boolean>;
}

const GROUP_NAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;

export function AddGroupModal({ existingGroupNames, onCancel, onSubmit }: AddGroupModalProps) {
  const { t } = useTranslation('users');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const validate = (): string | null => {
    if (!GROUP_NAME_RE.test(name)) {
      return t('AddGroupModal.invalidName');
    }
    if (existingGroupNames.includes(name)) return t('AddGroupModal.alreadyExists', { name });
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
    if (!ok) setError(t('AddGroupModal.requestFailed'));
  };

  return (
    <>
      <div className="detail-overlay" onClick={onCancel} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">{t('AddGroupModal.title')}</div>
          <button type="button" className="detail-panel__close" onClick={onCancel} aria-label={t('AddGroupModal.close')}>
            &#10005;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="dialog__body">
          <label className="form-field">
            <span className="form-field__label">{t('AddGroupModal.groupNameLabel')}</span>
            <input
              className="history-input"
              style={{ width: '100%' }}
              value={name}
              onChange={(e) => setName(e.target.value.toLowerCase())}
              placeholder={t('AddGroupModal.groupNamePlaceholder')}
              autoFocus
            />
          </label>

          <div className="status-note">{t('AddGroupModal.helpNote')}</div>

          {error && <div className="status-note status-note--error">{error}</div>}

          <div className="dialog__actions">
            <button type="button" className="btn" onClick={onCancel}>
              {t('AddGroupModal.cancel')}
            </button>
            <button type="submit" className="btn--primary" disabled={submitting}>
              {submitting ? t('AddGroupModal.creating') : t('AddGroupModal.createGroup')}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
