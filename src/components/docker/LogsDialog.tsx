import { useCallback, useEffect, useRef, useState } from 'react';
import { dockerApi } from '../../api/dockerApi';

interface LogsDialogProps {
  containerId: string;
  containerName: string;
  onClose: () => void;
}

const TAIL_OPTIONS = [100, 500, 2000];
const LIVE_POLL_MS = 2000;

function lastNonEmptyLine(text: string): string {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]) return lines[i];
  }
  return '';
}

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 40;
}

export function LogsDialog({ containerId, containerName, onClose }: LogsDialogProps) {
  const [logs, setLogs] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tail, setTail] = useState(500);
  const [live, setLive] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  // Cursor for the next live-tail poll, and the last line already shown - since's exact boundary
  // behavior (inclusive vs exclusive of that timestamp) isn't relied on; a poll response whose first
  // line matches lastLineRef just gets that one line dropped before appending.
  const sinceRef = useRef<number | null>(null);
  const lastLineRef = useRef('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await dockerApi.getContainerLogs(containerId, tail);
      setLogs(result.logs);
      sinceRef.current = result.nextSince;
      lastLineRef.current = lastNonEmptyLine(result.logs);
      requestAnimationFrame(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight }));
    } catch (err) {
      setError((err as Error).message);
      setLive(false);
    } finally {
      setLoading(false);
    }
  }, [containerId, tail]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!live) return;

    let cancelled = false;
    const poll = async () => {
      if (sinceRef.current === null) return;
      try {
        const result = await dockerApi.getContainerLogs(containerId, undefined, sinceRef.current);
        if (cancelled) return;
        if (result.nextSince !== null) sinceRef.current = result.nextSince;
        const lines = result.logs.split('\n').filter((l) => l.length > 0);
        const fresh = lines.length > 0 && lines[0] === lastLineRef.current ? lines.slice(1) : lines;
        if (fresh.length === 0) return;

        const el = logRef.current;
        const wasAtBottom = !el || isNearBottom(el);
        setLogs((prev) => (prev ? `${prev}\n${fresh.join('\n')}` : fresh.join('\n')));
        lastLineRef.current = fresh.at(-1)!;
        if (wasAtBottom) requestAnimationFrame(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight }));
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setLive(false);
        }
      }
    };

    poll();
    const id = setInterval(poll, LIVE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [live, containerId]);

  return (
    <>
      <div className="detail-overlay" onClick={onClose} />
      <div className="dialog docker-logs-dialog">
        <div className="dialog__head">
          <div className="dialog__title">Logs: {containerName}</div>
          <button type="button" className="detail-panel__close" onClick={onClose} aria-label="Close">
            &#10005;
          </button>
        </div>

        <div className="dialog__body">
          <div className="docker-logs-toolbar">
            <select className="history-input" value={tail} disabled={live} onChange={(e) => setTail(Number(e.target.value))}>
              {TAIL_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  Last {n} lines
                </option>
              ))}
            </select>
            <button type="button" className="btn" disabled={loading} onClick={load}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
            <label className="docker-logs-live-toggle">
              <input type="checkbox" checked={live} disabled={logs === null} onChange={(e) => setLive(e.target.checked)} />
              {live && <span className="status-dot" style={{ background: 'var(--color-green)', width: 6, height: 6 }} />}
              Live
            </label>
          </div>

          {error && <div className="status-note status-note--error">{error}</div>}

          {logs !== null && (
            <pre className="docker-logs-output" ref={logRef}>
              {logs || 'No log output.'}
            </pre>
          )}
        </div>
      </div>
    </>
  );
}
