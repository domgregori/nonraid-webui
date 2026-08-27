import { catppuccinLatte, catppuccinMacchiato } from '@catppuccin/codemirror';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import CodeMirror, { EditorView, type Extension } from '@uiw/react-codemirror';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { browseApi } from '../../api/browseApi';

interface EditFileDialogProps {
  path: string;
  fileName: string;
  onClose: () => void;
}

type EditorMode = 'light' | 'dark';

// Catppuccin's own theme sets its own font; only the mono font family carries over from this
// app's chrome, so the editor still reads as fixed-width code rather than Catppuccin's default.
const monoFont = EditorView.theme({ '.cm-content': { fontFamily: 'var(--font-mono)', fontSize: '13px' } });

// The app's theme preference (useTheme.ts) can be 'system', which resolves to light/dark via the
// prefers-color-scheme media query rather than any DOM attribute - this mirrors that same
// resolution so the editor opens matching whatever the app is actually showing right now.
function resolveAppMode(): EditorMode {
  const attr = document.documentElement.dataset.theme;
  if (attr === 'light' || attr === 'dark') return attr;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function EditFileDialog({ path, fileName, onClose }: EditFileDialogProps) {
  const { t } = useTranslation('browse');
  const [content, setContent] = useState<string | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [langExtension, setLangExtension] = useState<Extension | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);
  // Manual override, independent of the app's own theme - starts matching it, but the button in
  // the dialog head lets it diverge for this editing session without touching the app-wide setting.
  const [editorMode, setEditorMode] = useState<EditorMode>(resolveAppMode);

  const dirty = content !== null && content !== original;

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    browseApi
      .readFile(path)
      .then((result) => {
        setContent(result.content);
        setOriginal(result.content);
      })
      .catch((err) => setLoadError((err as Error).message))
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(() => {
    let cancelled = false;
    const desc = LanguageDescription.matchFilename(languages, fileName);
    if (!desc) return;
    desc.load().then((support) => {
      if (!cancelled) setLangExtension(support);
    });
    return () => {
      cancelled = true;
    };
  }, [fileName]);

  const extensions = useMemo(
    () => [editorMode === 'dark' ? catppuccinMacchiato : catppuccinLatte, monoFont, ...(langExtension ? [langExtension] : [])],
    [editorMode, langExtension],
  );

  const handleClose = () => {
    if (saving) return;
    if (dirty && !confirmingClose) {
      setConfirmingClose(true);
      return;
    }
    onClose();
  };

  const handleSave = async () => {
    if (content === null) return;
    setSaving(true);
    setSaveError(null);
    try {
      await browseApi.writeFile(path, content);
      setOriginal(content);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="detail-overlay" onClick={handleClose} />
      <div className="dialog browse-editor-dialog">
        <div className="dialog__head">
          <div className="dialog__title">
            {t('EditFileDialog.editTitle', { fileName })}
            {dirty && <span className="browse-editor-dirty-dot" title={t('EditFileDialog.unsavedChanges')} />}
          </div>
          <div className="browse-editor-head-actions">
            <button
              type="button"
              className="btn browse-editor-mode-toggle"
              onClick={() => setEditorMode((m) => (m === 'dark' ? 'light' : 'dark'))}
              title={t('EditFileDialog.toggleThemeTitle')}
            >
              {editorMode === 'dark' ? t('EditFileDialog.dark') : t('EditFileDialog.light')}
            </button>
            <button type="button" className="detail-panel__close" onClick={handleClose} aria-label={t('EditFileDialog.close')}>
              &#10005;
            </button>
          </div>
        </div>

        <div className="dialog__body browse-editor-body">
          {loading && <div className="status-note">{t('EditFileDialog.loading')}</div>}
          {loadError && <div className="status-note status-note--error">{loadError}</div>}

          {content !== null && (
            <CodeMirror
              value={content}
              height="60vh"
              theme="none"
              extensions={extensions}
              onChange={(value) => {
                setContent(value);
                setConfirmingClose(false);
              }}
            />
          )}

          {saveError && <div className="status-note status-note--error">{saveError}</div>}

          <div className="dialog__actions">
            <button type="button" className="btn" disabled={saving} onClick={handleClose}>
              {confirmingClose ? t('EditFileDialog.discardChanges') : t('EditFileDialog.close')}
            </button>
            <button type="button" className="btn btn--primary" disabled={saving || content === null || !dirty} onClick={handleSave}>
              {saving ? t('EditFileDialog.saving') : t('EditFileDialog.save')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
