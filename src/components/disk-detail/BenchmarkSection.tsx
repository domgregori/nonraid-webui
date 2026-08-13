import { useState } from 'react';
import { COLORS } from '../../styles/colors';
import type { BenchmarkResult } from '../../types/benchmark';
import { ProgressBar } from '../shared/ProgressBar';
import { TimeSeriesChart, type TimeSeriesChartSeries } from '../shared/TimeSeriesChart';

interface BenchmarkSectionProps {
  onRead: (durationSeconds: number) => Promise<BenchmarkResult>;
  /** Omitted entirely - the test runs read-only - for disks with no real mountpoint to write
   *  through (parity disks, unassigned devices). */
  onWrite?: (durationSeconds: number) => Promise<BenchmarkResult>;
}

type RunPhase = 'idle' | 'reading' | 'writing';

const DURATION_PRESETS: { label: string; seconds: number }[] = [
  { label: '4s', seconds: 4 },
  { label: '10s', seconds: 10 },
  { label: '30s', seconds: 30 },
  { label: '1 min', seconds: 60 },
  { label: '2 min', seconds: 120 },
  { label: '5 min', seconds: 300 },
];

function formatElapsed(s: number): string {
  return `${s.toFixed(1)}s`;
}

function formatMbPerSecond(v: number): string {
  return `${v.toFixed(0)} MB/s`;
}

/** Shared by the array-disk, unassigned-device, and boot-disk detail panels - same "one component,
 *  reused everywhere" approach as SmartOverviewRows. No client-side pre-disabling for an in-progress
 *  resync: the server already guards it (409), surfaced here the same way every other mutating
 *  action in this codebase reports a server-side rejection - via catch, after the fact. */
export function BenchmarkSection({ onRead, onWrite }: BenchmarkSectionProps) {
  const [durationSeconds, setDurationSeconds] = useState(DURATION_PRESETS[0].seconds);
  const [phase, setPhase] = useState<RunPhase>('idle');
  const [readResult, setReadResult] = useState<BenchmarkResult | null>(null);
  const [writeResult, setWriteResult] = useState<BenchmarkResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = phase !== 'idle';

  const run = async () => {
    setError(null);
    setReadResult(null);
    setWriteResult(null);
    setPhase('reading');
    try {
      const read = await onRead(durationSeconds);
      setReadResult(read);
      if (onWrite) {
        setPhase('writing');
        setWriteResult(await onWrite(durationSeconds));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPhase('idle');
    }
  };

  // Both series share the same 0-based elapsed-time axis (read and write each start counting from
  // their own start, even though write runs after read finishes) so the two curves overlap and can
  // be compared directly - e.g. "at 2s into its run, was read faster than write was at 2s into
  // its own run" - rather than reading as a single chronological timeline of the whole test.
  const series: TimeSeriesChartSeries[] = [];
  if (readResult && readResult.samples.length > 1) {
    series.push({
      key: 'read',
      label: 'Read',
      color: COLORS.blue,
      points: readResult.samples.map((s) => ({ ts: s.elapsedSeconds, value: s.mbPerSecond })),
    });
  }
  if (writeResult && writeResult.samples.length > 1) {
    series.push({
      key: 'write',
      label: 'Write',
      color: COLORS.green,
      points: writeResult.samples.map((s) => ({ ts: s.elapsedSeconds, value: s.mbPerSecond })),
    });
  }

  return (
    <div className="detail-card">
      <div className="eyebrow">Benchmark</div>

      <div className="detail-row">
        <span className="detail-row__label">Duration</span>
        <select
          className="history-input"
          value={durationSeconds}
          disabled={busy}
          onChange={(e) => setDurationSeconds(Number(e.target.value))}
        >
          {DURATION_PRESETS.map((p) => (
            <option key={p.seconds} value={p.seconds}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <button type="button" className="btn btn--block" disabled={busy} onClick={run}>
        {phase === 'reading' ? 'Reading…' : phase === 'writing' ? 'Writing…' : 'Run Benchmark'}
      </button>

      {busy && <ProgressBar indeterminate color={COLORS.blue} height={6} />}

      {(readResult || writeResult) && (
        <div className="detail-rows">
          {readResult && (
            <div className="detail-row">
              <span className="detail-row__label">Read Speed</span>
              <span className="detail-row__value">{readResult.mbPerSecond.toFixed(1)} MB/s</span>
            </div>
          )}
          {writeResult && (
            <div className="detail-row">
              <span className="detail-row__label">Write Speed</span>
              <span className="detail-row__value">{writeResult.mbPerSecond.toFixed(1)} MB/s</span>
            </div>
          )}
        </div>
      )}

      {series.length > 0 && <TimeSeriesChart series={series} formatTs={formatElapsed} formatValue={formatMbPerSecond} height={140} />}

      {error && <div className="status-note status-note--error">{error}</div>}
    </div>
  );
}
