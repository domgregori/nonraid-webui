import { useState } from 'react';
import { COLORS } from '../../styles/colors';
import type { BenchmarkResult } from '../../types/benchmark';
import { ProgressBar } from '../shared/ProgressBar';
import { TimeSeriesChart, type TimeSeriesChartSeries } from '../shared/TimeSeriesChart';

interface BenchmarkSectionProps {
  onRead: () => Promise<BenchmarkResult>;
  /** Omitted entirely — the test runs read-only — for disks with no real mountpoint to write
   *  through (parity disks, unassigned devices). */
  onWrite?: () => Promise<BenchmarkResult>;
}

type RunPhase = 'idle' | 'reading' | 'writing';

function formatElapsed(s: number): string {
  return `${s.toFixed(1)}s`;
}

function formatMbPerSecond(v: number): string {
  return `${v.toFixed(0)} MB/s`;
}

/** Shared by the array-disk, unassigned-device, and boot-disk detail panels — same "one component,
 *  reused everywhere" approach as SmartOverviewRows. No client-side pre-disabling for an in-progress
 *  resync: the server already guards it (409), surfaced here the same way every other mutating
 *  action in this codebase reports a server-side rejection — via catch, after the fact. */
export function BenchmarkSection({ onRead, onWrite }: BenchmarkSectionProps) {
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
      const read = await onRead();
      setReadResult(read);
      if (onWrite) {
        setPhase('writing');
        setWriteResult(await onWrite());
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPhase('idle');
    }
  };

  // One continuous timeline for the whole test: write's samples are offset by the read phase's
  // total duration, so the chart reads as "read, then write" in the order they actually ran —
  // read and write never run concurrently (same single-flight lock the backend already enforces),
  // so overlapping them on a shared 0-based axis would misleadingly suggest they were simultaneous.
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
    const offset = readResult?.elapsedSeconds ?? 0;
    series.push({
      key: 'write',
      label: 'Write',
      color: COLORS.green,
      points: writeResult.samples.map((s) => ({ ts: s.elapsedSeconds + offset, value: s.mbPerSecond })),
    });
  }

  return (
    <div className="detail-card">
      <div className="eyebrow">Benchmark</div>
      <button type="button" className="btn" disabled={busy} onClick={run}>
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
