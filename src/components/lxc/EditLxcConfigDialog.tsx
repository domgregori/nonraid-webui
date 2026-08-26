import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { lxcApi } from '../../api/lxcApi';

interface EditLxcConfigDialogProps {
  name: string;
  onClose: () => void;
  onDone: () => void;
}

/**
 * Edits the container's actual on-disk `config` file directly, not a
 * curated subset of fields - fits LXC better than Docker's create/recreate
 * model, since an LXC container isn't immutable: its config can be changed
 * in place (a restart picks up most changes; LXC only reads this file at
 * start). See backend/src/lxc/configFile.ts for the file this reads/writes.
 */
export function EditLxcConfigDialog({ name, onClose, onDone }: EditLxcConfigDialogProps) {
  const { t } = useTranslation('lxc');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    lxcApi
      .getConfigText(name)
      .then((res) => {
        if (!mounted) return;
        setContent(res.content);
        setLoading(false);
      })
      .catch((err) => {
        if (!mounted) return;
        setLoadError((err as Error).message);
        setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [name]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await lxcApi.setConfigText(name, content);
      onDone();
      onClose();
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog lxc-create-dialog">
        <div className="dialog__head">
          <div className="dialog__title">{t('EditLxcConfigDialog.title', { name })}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label={t('EditLxcConfigDialog.close')}>
            &#10005;
          </button>
        </div>

        {loading && <div className="status-note">{t('EditLxcConfigDialog.loading')}</div>}
        {loadError && <div className="status-note status-note--error">{loadError}</div>}

        {!loading && !loadError && (
          <div className="dialog__body">
            <div className="status-note">{t('EditLxcConfigDialog.editingNote')}</div>

            <textarea
              className="history-input settings-textarea"
              style={{ width: '100%' }}
              rows={20}
              spellCheck={false}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />

            {saveError && <div className="status-note status-note--error">{saveError}</div>}

            <div className="dialog__actions">
              <button type="button" className="btn" onClick={onClose}>
                {t('EditLxcConfigDialog.cancel')}
              </button>
              <button type="button" className="btn--primary" disabled={saving} onClick={handleSave}>
                {saving ? t('EditLxcConfigDialog.saving') : t('EditLxcConfigDialog.save')}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
