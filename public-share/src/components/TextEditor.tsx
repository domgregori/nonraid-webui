import { catppuccinLatte, catppuccinMacchiato } from '@catppuccin/codemirror';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import CodeMirror, { EditorView, type Extension } from '@uiw/react-codemirror';
import { useEffect, useMemo, useState } from 'react';
import { shareApi } from '../api';

interface TextEditorProps {
  token: string;
  path: string;
  fileName: string;
  // Read-only shares can view file content (GET /read allows it) but never save (POST /write
  // stays editable-only server-side regardless of what this prop does) - this just drives the UI
  // to match: no Save button, no dirty-tracking/close-confirmation (nothing can become dirty),
  // and CodeMirror itself refuses input rather than silently discarding it on close.
  readOnly: boolean;
  onClose: () => void;
}

// Reuses the admin app's own CodeMirror 6 setup (src/components/browse/EditFileDialog.tsx) - same
// theme package, same mono-font override, same filename-based language auto-detection - so the
// editing experience here doesn't feel like a different, hastily-built tool.
const monoFont = EditorView.theme({ '.cm-content': { fontFamily: 'ui-monospace, "JetBrains Mono", monospace', fontSize: '13px' } });

export function TextEditor({ token, path, fileName, readOnly, onClose }: TextEditorProps) {
  const [content, setContent] = useState<string | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState(false);
  const [langExtension, setLangExtension] = useState<Extension | null>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);

  const dirty = !readOnly && content !== null && content !== original;

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    shareApi
      .readFile(token, path)
      .then((result) => {
        setContent(result.content);
        setOriginal(result.content);
      })
      .catch((err) => setLoadError((err as Error).message))
      .finally(() => setLoading(false));
  }, [token, path]);

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

  const extensions = useMemo(() => [dark ? catppuccinMacchiato : catppuccinLatte, monoFont, ...(langExtension ? [langExtension] : [])], [dark, langExtension]);

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
    setSavedNote(false);
    try {
      await shareApi.writeFile(token, path, content);
      setOriginal(content);
      setSavedNote(true);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ps-overlay">
      <div className="ps-editor">
        <div className="ps-editor__head">
          <div className="ps-editor__title">
            {fileName}
            {readOnly && <span className="ps-note" style={{ marginLeft: 8 }}>(view only)</span>}
            {dirty && <span className="ps-dirty-dot" title="Unsaved changes" />}
          </div>
          <div className="ps-editor__actions">
            <button type="button" className="ps-btn" onClick={() => setDark((d) => !d)}>
              {dark ? 'Light' : 'Dark'}
            </button>
            <button type="button" className="ps-btn" onClick={handleClose} aria-label="Close">
              ✕
            </button>
          </div>
        </div>

        <div className="ps-editor__body">
          {loading && <div className="ps-note">Loading…</div>}
          {loadError && <div className="ps-error">{loadError}</div>}

          {content !== null && (
            <CodeMirror
              value={content}
              height="60vh"
              theme="none"
              readOnly={readOnly}
              extensions={extensions}
              onChange={(value) => {
                if (readOnly) return;
                setContent(value);
                setConfirmingClose(false);
                setSavedNote(false);
              }}
            />
          )}

          {saveError && <div className="ps-error">{saveError}</div>}
          {savedNote && !dirty && <div className="ps-note">Saved.</div>}

          <div className="ps-editor__footer">
            <button type="button" className="ps-btn" disabled={saving} onClick={handleClose}>
              {confirmingClose ? 'Discard changes' : 'Close'}
            </button>
            {!readOnly && (
              <button type="button" className="ps-btn ps-btn--primary" disabled={saving || content === null || !dirty} onClick={handleSave}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
