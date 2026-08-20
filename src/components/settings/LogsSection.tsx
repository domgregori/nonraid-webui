import { useCallback, useEffect, useRef, useState } from 'react';
import { logsApi, type LogSource } from '../../api/logsApi';

const TAIL_OPTIONS = [200, 500, 2000, 5000];
const WINDOW_OPTIONS: Array<{ id: string; label: string }> = [
  { id: '15m', label: 'Last 15 min' },
  { id: '1h', label: 'Last hour' },
  { id: '6h', label: 'Last 6 hours' },
  { id: '24h', label: 'Last 24 hours' },
  { id: '7d', label: 'Last 7 days' },
  { id: 'all', label: 'All available' },
];
const LIVE_POLL_MS = 2000;

// A line that looks like an error/failure or a warning gets picked out visually - the one bit of
// interpretation this viewer adds over a raw `journalctl` dump, since a wall of monospace text is
// exactly the failure mode this page exists to avoid.
const ERROR_RE = /\b(error|err|fail(?:ed|ure)?|critical|crit|panic|fatal|denied|refused)\b/i;
const WARN_RE = /\bwarn(?:ing)?\b/i;

function severityClass(line: string): string {
  if (ERROR_RE.test(line)) return 'logs-line--error';
  if (WARN_RE.test(line)) return 'logs-line--warn';
  return '';
}

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

interface LogsSectionProps {
  /** Whether the "System Logs" Settings tab is the one currently on screen. Settings sections stay
   *  mounted (hidden via CSS) rather than unmounting on tab switch, so live-tail polling is gated on
   *  this instead of on mount/unmount - otherwise leaving Live on and switching tabs would keep
   *  spawning `journalctl` every 2s in the background indefinitely. */
  active: boolean;
}

export function LogsSection({ active }: LogsSectionProps) {
  const [sources, setSources] = useState<LogSource[] | null>(null);
  const [sourcesError, setSourcesError] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [tail, setTail] = useState(500);
  const [windowId, setWindowId] = useState('1h');
  const [live, setLive] = useState(false);
  const [logs, setLogs] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  // Cursor for the next live-tail poll, and the last line already shown - same scheme as the
  // Docker logs dialog: a poll response whose first line matches lastLineRef just gets that one
  // line dropped before appending, rather than relying on --since's exact inclusive/exclusive edge.
  const sinceRef = useRef<number | null>(null);
  const lastLineRef = useRef('');

  useEffect(() => {
    logsApi
      .listSources()
      .then((list) => {
        setSources(list);
        setSourceId((prev) => prev ?? list[0]?.id ?? null);
      })
      .catch((err) => setSourcesError((err as Error).message));
  }, []);

  const load = useCallback(async () => {
    if (!sourceId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await logsApi.getLogs(sourceId, { tail, window: windowId });
      setLogs(result.logs);
      sinceRef.current = result.nextSince;
      lastLineRef.current = lastNonEmptyLine(result.logs);
      requestAnimationFrame(() => outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight }));
    } catch (err) {
      setError((err as Error).message);
      setLive(false);
    } finally {
      setLoading(false);
    }
  }, [sourceId, tail, windowId]);

  // Lazy-loads only once this tab is actually on screen, and whenever the source/tail/window
  // selection changes while it is.
  useEffect(() => {
    if (!active) return;
    load();
  }, [active, load]);

  useEffect(() => {
    if (!live || !active || !sourceId) return;

    let cancelled = false;
    const poll = async () => {
      if (sinceRef.current === null) return;
      try {
        const result = await logsApi.getLogs(sourceId, { since: sinceRef.current });
        if (cancelled) return;
        if (result.nextSince !== null) sinceRef.current = result.nextSince;
        const lines = result.logs.split('\n').filter((l) => l.length > 0);
        const fresh = lines.length > 0 && lines[0] === lastLineRef.current ? lines.slice(1) : lines;
        if (fresh.length === 0) return;

        const el = outputRef.current;
        const wasAtBottom = !el || isNearBottom(el);
        setLogs((prev) => (prev ? `${prev}\n${fresh.join('\n')}` : fresh.join('\n')));
        lastLineRef.current = fresh.at(-1)!;
        if (wasAtBottom) requestAnimationFrame(() => outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight }));
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
  }, [live, active, sourceId]);

  const selectSource = (id: string) => {
    if (id === sourceId) return;
    setSourceId(id);
    setLive(false);
    setLogs(null);
  };

  if (sourcesError) return <div className="status-note status-note--error">{sourcesError}</div>;
  if (!sources) return <div className="status-note">Loading log sources…</div>;

  return (
    <div>
      <div className="docker-logs-toolbar">
        <select className="history-input" value={sourceId ?? ''} onChange={(e) => selectSource(e.target.value)}>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        <select className="history-input" value={tail} disabled={live} onChange={(e) => setTail(Number(e.target.value))}>
          {TAIL_OPTIONS.map((n) => (
            <option key={n} value={n}>
              Last {n} lines
            </option>
          ))}
        </select>
        <select className="history-input" value={windowId} disabled={live} onChange={(e) => setWindowId(e.target.value)}>
          {WINDOW_OPTIONS.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label}
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
        <div className="logs-output" ref={outputRef}>
          {logs === '' ? (
            'No log output for this range.'
          ) : (
            logs.split('\n').map((line, i) => (
              <div key={i} className={`logs-line ${severityClass(line)}`}>
                {line || ' '}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
