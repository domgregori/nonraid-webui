import { lazy, Suspense, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BulkActionBar } from '../components/browse/BulkActionBar';
import { BulkProgressDialog } from '../components/browse/BulkProgressDialog';
import { Breadcrumbs } from '../components/browse/Breadcrumbs';
import { NewFolderModal } from '../components/browse/NewFolderModal';
import { RenameModal } from '../components/browse/RenameModal';
import { TransferModal } from '../components/browse/TransferModal';
import { useBrowse } from '../hooks/useBrowse';
import { LOCATION_TYPE_COLOR, LOCATION_TYPE_LABEL } from '../selectors/browse';
import type { BrowseEntry, BrowseLocationType } from '../types/browseApi';
import { formatFileSize } from '../utils/format';

// Lazy - CodeMirror's core (not just its per-language chunks, which already code-split on their
// own) is real weight, and this app has no other route-level code-splitting today. Loading it
// only when someone actually opens a file keeps it out of every other page's shared bundle.
const EditFileDialog = lazy(() => import('../components/browse/EditFileDialog').then((m) => ({ default: m.EditFileDialog })));

function formatModified(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function BrowsePage() {
  const { t } = useTranslation('pages');
  const browse = useBrowse();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [renamingEntry, setRenamingEntry] = useState<BrowseEntry | null>(null);
  const [transfer, setTransfer] = useState<{ op: 'copy' | 'move'; entries: BrowseEntry[] } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [calculating, setCalculating] = useState<Set<string>>(new Set());
  const [editingEntry, setEditingEntry] = useState<{ path: string; name: string } | null>(null);

  const ready = browse.status === 'ready';
  const entries = browse.listing?.entries ?? [];
  const allSelected = entries.length > 0 && entries.every((e) => browse.selected.has(e.name));
  // Only ever set at exactly two depths (see backend/src/browse/types.ts's BrowseLocationType doc
  // comment) - computed from what's actually present rather than a fixed list, so the legend only
  // shows entries that are actually on screen (e.g. no "Cache" row before a cache pool exists).
  const presentLocationTypes = [...new Set(entries.map((e) => e.locationType).filter((t): t is BrowseLocationType => t !== undefined))];
  // A directory legitimately spans multiple disks in a pool - that's the whole point of mergerfs.
  // A *file* on more than one is not: something bypassed mergerfs (direct disk access outside
  // this app, e.g. over SSH) and wrote the same name onto two branches independently - mergerfs
  // then has to arbitrarily pick one to actually serve, silently stranding the other with whatever
  // it holds (same data, or not - no way to tell without comparing them by hand). Rare, but a real
  // footgun once it happens, so it's called out rather than left to look like an ordinary file.
  const isFileConflict = (entry: BrowseEntry) => entry.type === 'file' && (entry.locations?.length ?? 0) > 1;
  const hasFileConflicts = entries.some(isFileConflict);

  const handleDeleteClick = (entry: BrowseEntry) => {
    if (confirmingDelete === entry.name) {
      browse.startBulk('delete', [entry]);
      setConfirmingDelete(null);
    } else {
      setConfirmingDelete(entry.name);
    }
  };

  const handleCalculate = async (entry: BrowseEntry) => {
    setCalculating((prev) => new Set(prev).add(entry.name));
    try {
      await browse.calculateSize(entry);
    } finally {
      setCalculating((prev) => {
        const next = new Set(prev);
        next.delete(entry.name);
        return next;
      });
    }
  };

  const selectedEntries = entries.filter((e) => browse.selected.has(e.name));

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">{t('BrowsePage.title')}</div>
        {browse.selected.size > 0 ? (
          <BulkActionBar
            count={browse.selected.size}
            onClear={browse.clearSelection}
            onCopy={() => setTransfer({ op: 'copy', entries: selectedEntries })}
            onMove={() => setTransfer({ op: 'move', entries: selectedEntries })}
            onDelete={() => browse.startBulk('delete', selectedEntries)}
          />
        ) : (
          <div className="browse-toolbar">
            <button type="button" className="btn" disabled={!ready} onClick={() => setCreatingFolder(true)}>
              {t('BrowsePage.newFolder')}
            </button>
            <button type="button" className="btn--primary" disabled={!ready} onClick={() => fileInputRef.current?.click()}>
              {t('BrowsePage.upload')}
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
        )}
      </div>

      <Breadcrumbs path={browse.path} onNavigate={browse.navigate} />

      {(presentLocationTypes.length > 0 || hasFileConflicts) && (
        <div className="browse-legend">
          {presentLocationTypes.map((t) => (
            <span key={t} className="browse-legend__item">
              <span className="docker-card__status-dot" style={{ background: LOCATION_TYPE_COLOR[t] }} />
              {LOCATION_TYPE_LABEL[t]}
            </span>
          ))}
          {hasFileConflicts && (
            <span className="browse-legend__item">
              <span className="browse-conflict-icon">!</span>
              {t('BrowsePage.fileConflictLegend')}
            </span>
          )}
        </div>
      )}

      {browse.status === 'loading' && <div className="status-note">{t('BrowsePage.loading')}</div>}
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
          <div className="browse-row__checkbox">
            <input type="checkbox" checked={allSelected} onChange={() => (allSelected ? browse.clearSelection() : browse.selectAll())} aria-label={t('BrowsePage.selectAll')} />
          </div>
          <div>{t('BrowsePage.nameColumn')}</div>
          <div>{t('BrowsePage.sizeColumn')}</div>
          <div>{t('BrowsePage.modifiedColumn')}</div>
          <div>{t('BrowsePage.locationColumn')}</div>
          <div />
        </div>

        {browse.canGoUp && (
          <div className="browse-row browse-row--dir" onClick={browse.up}>
            <div className="browse-row__checkbox" />
            <div className="browse-row__name">
              <span className="browse-row__name-text--dir">..</span>
            </div>
            <div className="browse-row__size" />
            <div className="browse-row__modified" />
            <div className="browse-row__location" />
            <div className="browse-row__actions" />
          </div>
        )}

        {entries.map((entry) => {
          const absPath = browse.path.endsWith('/') ? `${browse.path}${entry.name}` : `${browse.path}/${entry.name}`;
          const knownSize = browse.sizes[absPath];
          return (
            <div
              key={entry.name}
              className={`browse-row${entry.type === 'directory' ? ' browse-row--dir' : ''}`}
              onClick={() => browse.open(entry)}
            >
              <div className="browse-row__checkbox" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={browse.selected.has(entry.name)} onChange={() => browse.toggleSelect(entry.name)} aria-label={t('BrowsePage.selectEntry', { name: entry.name })} />
              </div>
              <div className="browse-row__name">
                {entry.locationType && (
                  <span
                    className="docker-card__status-dot"
                    style={{ background: LOCATION_TYPE_COLOR[entry.locationType], marginRight: 6 }}
                    title={LOCATION_TYPE_LABEL[entry.locationType]}
                  />
                )}
                {entry.type === 'file' && entry.editable ? (
                  <button
                    type="button"
                    className="browse-row__name-text--file browse-row__name-text--editable"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingEntry({ path: absPath, name: entry.name });
                    }}
                  >
                    {entry.name}
                  </button>
                ) : (
                  <span className={`browse-row__name-text--${entry.type}`}>{entry.name}</span>
                )}
                {isFileConflict(entry) && (
                  <span
                    className="browse-conflict-icon"
                    style={{ marginLeft: 6 }}
                    title={t('BrowsePage.fileConflictTooltip', { locations: entry.locations?.join(', ') })}
                  >
                    !
                  </span>
                )}
              </div>
              <div className="browse-row__size" onClick={(e) => e.stopPropagation()}>
                {entry.type === 'directory' ? (
                  knownSize !== undefined ? (
                    formatFileSize(knownSize)
                  ) : (
                    <button type="button" className="browse-calculate-btn" disabled={calculating.has(entry.name)} onClick={() => handleCalculate(entry)}>
                      {calculating.has(entry.name) ? '…' : t('BrowsePage.calculate')}
                    </button>
                  )
                ) : (
                  formatFileSize(entry.size)
                )}
              </div>
              <div className="browse-row__modified">{formatModified(entry.modifiedAt)}</div>
              <div className="browse-row__location">{entry.locations && entry.locations.length > 0 ? entry.locations.join(', ') : '-'}</div>
              <div className="browse-row__actions" onClick={(e) => e.stopPropagation()}>
                {entry.type === 'file' && (
                  <a className="btn" href={browse.downloadUrl(entry)} download={entry.name}>
                    {t('BrowsePage.download')}
                  </a>
                )}
                <button type="button" className="btn" onClick={() => setRenamingEntry(entry)}>
                  {t('BrowsePage.rename')}
                </button>
                <button type="button" className="btn" onClick={() => setTransfer({ op: 'copy', entries: [entry] })}>
                  {t('BrowsePage.copy')}
                </button>
                <button type="button" className="btn" onClick={() => setTransfer({ op: 'move', entries: [entry] })}>
                  {t('BrowsePage.move')}
                </button>
                <button type="button" className="btn btn--danger" onClick={() => handleDeleteClick(entry)}>
                  {confirmingDelete === entry.name ? t('BrowsePage.confirmQuestion') : t('BrowsePage.delete')}
                </button>
              </div>
            </div>
          );
        })}

        {browse.status === 'ready' && entries.length === 0 && (
          <div className="browse-dropzone-hint">{t('BrowsePage.emptyFolder')}</div>
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

      {transfer && (
        <TransferModal
          op={transfer.op}
          entries={transfer.entries}
          currentPath={browse.path}
          onCancel={() => setTransfer(null)}
          onStart={(destPath) => {
            browse.startBulk(transfer.op, transfer.entries, destPath);
            setTransfer(null);
          }}
        />
      )}

      {browse.bulkJob && <BulkProgressDialog job={browse.bulkJob} onCancel={browse.cancelBulk} onDismiss={browse.dismissBulk} />}

      {editingEntry && (
        <Suspense fallback={<div className="detail-overlay" />}>
          <EditFileDialog path={editingEntry.path} fileName={editingEntry.name} onClose={() => setEditingEntry(null)} />
        </Suspense>
      )}
    </div>
  );
}
