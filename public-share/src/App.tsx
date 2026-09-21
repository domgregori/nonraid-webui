import { useCallback, useEffect, useState } from 'react';
import { currentToken, shareApi, type BrowseResult, type ShareEntry, type ShareInfo } from './api';
import { FileBrowser } from './components/FileBrowser';
import { TextEditor } from './components/TextEditor';
import { UnlockForm } from './components/UnlockForm';
import { UploadForm } from './components/UploadForm';

function pathFromLocation(): string {
  return new URLSearchParams(window.location.search).get('path') ?? '';
}

export function App() {
  const token = currentToken();
  const [info, setInfo] = useState<ShareInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState(false);

  const [path, setPath] = useState(pathFromLocation);
  const [browse, setBrowse] = useState<BrowseResult | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ShareEntry | null>(null);

  useEffect(() => {
    const onPop = () => setPath(pathFromLocation());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (!token) {
      setInfoError('No share token in the URL.');
      return;
    }
    shareApi
      .getInfo(token)
      .then((result) => {
        setInfo(result);
        if (!result.requiresPassword) setUnlocked(true);
      })
      .catch((err) => setInfoError((err as Error).message));
  }, [token]);

  const loadFolder = useCallback(
    (p: string) => {
      if (!unlocked || !info || info.mode === 'upload-only') return;
      setBrowseLoading(true);
      setBrowseError(null);
      shareApi
        .browse(token, p)
        .then(setBrowse)
        .catch((err) => setBrowseError((err as Error).message))
        .finally(() => setBrowseLoading(false));
    },
    [token, unlocked, info],
  );

  useEffect(() => {
    loadFolder(path);
  }, [path, loadFolder]);

  const navigate = (next: string) => {
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('path', next);
    else url.searchParams.delete('path');
    window.history.pushState({}, '', url);
    setPath(next);
  };

  const handleUnlock = async (password: string) => {
    const result = await shareApi.unlock(token, password);
    setInfo((prev) => (prev ? { ...prev, mode: result.mode, label: result.label } : prev));
    setUnlocked(true);
  };

  if (infoError) {
    return (
      <div className="ps-page">
        <div className="ps-card">
          <h1 className="ps-title">Not available</h1>
          <p className="ps-error">{infoError}</p>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="ps-page">
        <div className="ps-note">Loading…</div>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="ps-page">
        <UnlockForm info={info} onUnlock={handleUnlock} />
      </div>
    );
  }

  return (
    <div className="ps-page">
      <header className="ps-header">
        <h1 className="ps-title">{info.label || 'Shared files'}</h1>
      </header>

      {(info.mode === 'upload-only' || info.mode === 'editable') && (
        <UploadForm token={token} path={info.mode === 'upload-only' ? '' : path} onUploaded={() => loadFolder(path)} />
      )}

      {info.mode !== 'upload-only' && (
        <FileBrowser
          path={path}
          entries={browse?.entries ?? []}
          mode={info.mode}
          loading={browseLoading}
          error={browseError}
          onNavigate={navigate}
          onOpenFile={(entry) => setEditing(entry)}
          downloadHref={(p) => shareApi.downloadUrl(token, p)}
        />
      )}

      {editing && (
        <TextEditor
          token={token}
          path={path ? `${path}/${editing.name}` : editing.name}
          fileName={editing.name}
          onClose={() => {
            setEditing(null);
            loadFolder(path);
          }}
        />
      )}
    </div>
  );
}
