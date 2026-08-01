import { useCallback, useEffect, useRef, useState } from 'react';
import { dockerApi } from '../../api/dockerApi';

interface LogsDialogProps {
  containerId: string;
  containerName: string;
  onClose: () => void;
}

const TAIL_OPTIONS = [100, 500, 2000];

export function LogsDialog({ containerId, containerName, onClose }: LogsDialogProps) {
  const [logs, setLogs] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tail, setTail] = useState(500);
  const logRef = useRef<HTMLPreElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await dockerApi.getContainerLogs(containerId, tail);
      setLogs(result.logs);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [containerId, tail]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (logs !== null) logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs]);

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
            <select className="history-input" value={tail} onChange={(e) => setTail(Number(e.target.value))}>
              {TAIL_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  Last {n} lines
                </option>
              ))}
            </select>
            <button type="button" className="btn" disabled={loading} onClick={load}>
              {loading ? 'Loading…' : 'Refresh'}
            </button>
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
