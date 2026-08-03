import { useRef, useState } from 'react';
import { Breadcrumbs } from '../components/browse/Breadcrumbs';
import { MoveModal } from '../components/browse/MoveModal';
import { NewFolderModal } from '../components/browse/NewFolderModal';
import { RenameModal } from '../components/browse/RenameModal';
import { useBrowse } from '../hooks/useBrowse';
import type { BrowseEntry } from '../types/browseApi';
import { formatFileSize } from '../utils/format';

function formatModified(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function BrowsePage() {
  const browse = useBrowse();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [renamingEntry, setRenamingEntry] = useState<BrowseEntry | null>(null);
  const [movingEntry, setMovingEntry] = useState<BrowseEntry | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  const ready = browse.status === 'ready';

  const handleDeleteClick = (entry: BrowseEntry) => {
    if (confirmingDelete === entry.name) {
      browse.remove(entry);
      setConfirmingDelete(null);
    } else {
      setConfirmingDelete(entry.name);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">Browse</div>
        <div className="browse-toolbar">
          <button type="button" className="btn" disabled={!ready} onClick={() => setCreatingFolder(true)}>
            New Folder
          </button>
          <button type="button" className="btn--primary" disabled={!ready} onClick={() => fileInputRef.current?.click()}>
            Upload
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) browse.upload(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <Breadcrumbs path={browse.path} onNavigate={browse.navigate} />

      {browse.status === 'loading' && <div className="status-note">Loading…</div>}
      {browse.error && <div className="status-note status-note--error">{browse.error}</div>}
      {browse.actionError && <div className="status-note status-note--error">{browse.actionError}</div>}

      <div
        className={`browse-table${dragOver ? ' browse-table--dragover' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length > 0) browse.upload(e.dataTransfer.files);
        }}
      >
        <div className="browse-table__head">
          <div>Name</div>
          <div>Size</div>
          <div>Modified</div>
          <div />
        </div>

        {browse.canGoUp && (
          <div className="browse-row browse-row--dir" onClick={browse.up}>
            <div className="browse-row__name">
              <span className="browse-row__name-text--dir">..</span>
            </div>
            <div className="browse-row__size" />
            <div className="browse-row__modified" />
            <div className="browse-row__actions" />
          </div>
        )}

        {browse.listing?.entries.map((entry) => (
          <div
            key={entry.name}
            className={`browse-row${entry.type === 'directory' ? ' browse-row--dir' : ''}`}
            onClick={() => browse.open(entry)}
          >
            <div className="browse-row__name">
              <span className={`browse-row__name-text--${entry.type}`}>{entry.name}</span>
            </div>
            <div className="browse-row__size">{entry.type === 'directory' ? '—' : formatFileSize(entry.size)}</div>
            <div className="browse-row__modified">{formatModified(entry.modifiedAt)}</div>
            <div className="browse-row__actions" onClick={(e) => e.stopPropagation()}>
              {entry.type === 'file' && (
                <a className="btn" href={browse.downloadUrl(entry)} download={entry.name}>
                  Download
                </a>
              )}
              <button type="button" className="btn" onClick={() => setRenamingEntry(entry)}>
                Rename
              </button>
              <button type="button" className="btn" onClick={() => setMovingEntry(entry)}>
                Move
              </button>
              <button type="button" className="btn btn--danger" onClick={() => handleDeleteClick(entry)}>
                {confirmingDelete === entry.name ? 'Confirm?' : 'Delete'}
              </button>
            </div>
          </div>
        ))}

        {browse.status === 'ready' && browse.listing?.entries.length === 0 && (
          <div className="browse-dropzone-hint">This folder is empty — drag files here, or use Upload.</div>
        )}
      </div>

      {creatingFolder && (
        <NewFolderModal
          onCancel={() => setCreatingFolder(false)}
          onSubmit={async (name) => {
            const ok = await browse.mkdir(name);
            if (ok) setCreatingFolder(false);
            return ok;
          }}
        />
      )}

      {renamingEntry && (
        <RenameModal
          entry={renamingEntry}
          onCancel={() => setRenamingEntry(null)}
          onSubmit={async (newName) => {
            const ok = await browse.rename(renamingEntry, newName);
            if (ok) setRenamingEntry(null);
            return ok;
          }}
        />
      )}

      {movingEntry && (
        <MoveModal
          entry={movingEntry}
          currentPath={browse.path}
          onCancel={() => setMovingEntry(null)}
          onSubmit={async (destPath) => {
            const ok = await browse.move(movingEntry, destPath);
            if (ok) setMovingEntry(null);
            return ok;
          }}
        />
      )}
    </div>
  );
}
