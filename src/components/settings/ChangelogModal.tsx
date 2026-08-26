import { useEffect, useState } from 'react';
import { updateApi } from '../../api/updateApi';
import type { UpdateComponent } from '../../types/updateApi';
import { renderSimpleMarkdown } from '../../utils/simpleMarkdown';

interface ChangelogModalProps {
  component: UpdateComponent;
  label: string;
  tag: string;
  onClose: () => void;
}

/** Renders the GitHub Release body through a small hand-rolled Markdown-lite renderer (see
 *  utils/simpleMarkdown.tsx) rather than pulling in a full Markdown library - this project's own
 *  release notes only ever use headers, bullet lists, and paragraphs. */
export function ChangelogModal({ component, label, tag, onClose }: ChangelogModalProps) {
  const [body, setBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    updateApi
      .getChangelog(component, tag)
      .then((result) => setBody(result.body))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [component, tag]);

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog">
        <div className="dialog__head">
          <div className="dialog__title">
            {label} {tag}
          </div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>
        <div className="dialog__body">
          {loading && <div className="status-note">Loading…</div>}
          {error && <div className="status-note status-note--error">{error}</div>}
          {!loading && !error && (
            <div className="changelog-body" style={{ maxHeight: '60vh', overflow: 'auto' }}>
              {body ? renderSimpleMarkdown(body) : 'No release notes published for this version.'}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
