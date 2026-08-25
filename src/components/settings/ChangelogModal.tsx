import { useEffect, useState } from 'react';
import { updateApi } from '../../api/updateApi';
import type { UpdateComponent } from '../../types/updateApi';

interface ChangelogModalProps {
  component: UpdateComponent;
  label: string;
  tag: string;
  onClose: () => void;
}

/** Plain preformatted text, not rendered Markdown - GitHub Release bodies are Markdown, but a
 *  renderer means either a new dependency or hand-rolling one, and this is meant as a first,
 *  simple pass. Bullet lists/headers still read fine as plain text; links/emphasis just show
 *  their raw syntax. */
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
            <pre className="settings-field__hint" style={{ maxHeight: '60vh', overflow: 'auto', whiteSpace: 'pre-wrap', margin: 0 }}>
              {body ?? 'No release notes published for this version.'}
            </pre>
          )}
        </div>
      </div>
    </>
  );
}
