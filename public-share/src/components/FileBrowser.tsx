import type { ShareEntry, ShareMode } from '../api';

interface FileBrowserProps {
  path: string;
  entries: ShareEntry[];
  mode: ShareMode;
  loading: boolean;
  error: string | null;
  onNavigate: (path: string) => void;
  onOpenFile: (entry: ShareEntry) => void;
  downloadHref: (path: string) => string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function breadcrumbs(path: string): { label: string; path: string }[] {
  const segments = path.split('/').filter(Boolean);
  const crumbs = [{ label: 'Home', path: '' }];
  let acc = '';
  for (const seg of segments) {
    acc = acc ? `${acc}/${seg}` : seg;
    crumbs.push({ label: seg, path: acc });
  }
  return crumbs;
}

export function FileBrowser({ path, entries, mode, loading, error, onNavigate, onOpenFile, downloadHref }: FileBrowserProps) {
  return (
    <div className="ps-browser">
      <nav className="ps-breadcrumbs" aria-label="Folder path">
        {breadcrumbs(path).map((crumb, i, arr) => (
          <span key={crumb.path}>
            {i > 0 && <span className="ps-breadcrumb-sep">/</span>}
            {i === arr.length - 1 ? (
              <span className="ps-breadcrumb-current">{crumb.label}</span>
            ) : (
              <button type="button" className="ps-breadcrumb-link" onClick={() => onNavigate(crumb.path)}>
                {crumb.label}
              </button>
            )}
          </span>
        ))}
      </nav>

      {loading && <div className="ps-note">Loading…</div>}
      {error && <div className="ps-error">{error}</div>}

      {!loading && !error && (
        <ul className="ps-entries">
          {entries.length === 0 && <li className="ps-note">This folder is empty.</li>}
          {entries.map((entry) => {
            const entryPath = path ? `${path}/${entry.name}` : entry.name;
            if (entry.type === 'directory') {
              return (
                <li key={entry.name} className="ps-entry ps-entry--dir">
                  <button type="button" className="ps-entry__link" onClick={() => onNavigate(entryPath)}>
                    <span className="ps-entry__icon">📁</span>
                    <span className="ps-entry__name">{entry.name}</span>
                  </button>
                </li>
              );
            }
            return (
              <li key={entry.name} className="ps-entry">
                <span className="ps-entry__icon">📄</span>
                <span className="ps-entry__name">{entry.name}</span>
                <span className="ps-entry__size">{formatSize(entry.size)}</span>
                <span className="ps-entry__actions">
                  <a className="ps-btn ps-btn--small" href={downloadHref(entryPath)}>
                    Download
                  </a>
                  {mode === 'editable' && entry.editable && (
                    <button type="button" className="ps-btn ps-btn--small" onClick={() => onOpenFile(entry)}>
                      Edit
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
