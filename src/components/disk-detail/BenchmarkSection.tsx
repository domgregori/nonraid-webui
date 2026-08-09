import { useState } from 'react';
import { COLORS } from '../../styles/colors';
import type { BenchmarkResult } from '../../types/benchmark';
import { ProgressBar } from '../shared/ProgressBar';
import { TimeSeriesChart } from '../shared/TimeSeriesChart';

interface BenchmarkSectionProps {
  onRead: () => Promise<BenchmarkResult>;
  /** Omitted entirely — no Write button rendered — for disks with no real mountpoint to write
   *  through (parity disks, unassigned devices). */
  onWrite?: () => Promise<BenchmarkResult>;
}

type RunState = 'idle' | 'pending';

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
  const [readState, setReadState] = useState<RunState>('idle');
  const [readResult, setReadResult] = useState<BenchmarkResult | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [writeState, setWriteState] = useState<RunState>('idle');
  const [writeResult, setWriteResult] = useState<BenchmarkResult | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  const busy = readState === 'pending' || writeState === 'pending';

  const runRead = async () => {
    setReadState('pending');
    setReadError(null);
    try {
      setReadResult(await onRead());
    } catch (err) {
      setReadError((err as Error).message);
    } finally {
      setReadState('idle');
    }
  };

  const runWrite = async () => {
    if (!onWrite) return;
    setWriteState('pending');
    setWriteError(null);
    try {
      setWriteResult(await onWrite());
    } catch (err) {
      setWriteError((err as Error).message);
    } finally {
      setWriteState('idle');
    }
  };

  return (
    <div className="detail-card">
      <div className="eyebrow">Benchmark</div>
      <div className="smart-selftest__actions">
        <button type="button" className="btn" disabled={busy} onClick={runRead}>
          {readState === 'pending' ? 'Reading…' : 'Benchmark Read'}
        </button>
        {onWrite && (
          <button type="button" className="btn" disabled={busy} onClick={runWrite}>
            {writeState === 'pending' ? 'Writing…' : 'Benchmark Write'}
          </button>
        )}
      </div>

      {busy && <ProgressBar indeterminate color={COLORS.blue} height={6} />}

      {readResult && (
        <>
          <div className="detail-rows">
            <div className="detail-row">
              <span className="detail-row__label">Read Speed</span>
              <span className="detail-row__value">{readResult.mbPerSecond.toFixed(1)} MB/s</span>
            </div>
          </div>
          {readResult.samples.length > 1 && (
            <TimeSeriesChart
              series={[
                {
                  key: 'read',
                  label: 'Read',
                  color: COLORS.blue,
                  points: readResult.samples.map((s) => ({ ts: s.elapsedSeconds, value: s.mbPerSecond })),
                },
              ]}
              formatTs={formatElapsed}
              formatValue={formatMbPerSecond}
              height={120}
            />
          )}
        </>
      )}
      {readError && <div className="status-note status-note--error">{readError}</div>}

      {writeResult && (
        <>
          <div className="detail-rows">
            <div className="detail-row">
              <span className="detail-row__label">Write Speed</span>
              <span className="detail-row__value">{writeResult.mbPerSecond.toFixed(1)} MB/s</span>
            </div>
          </div>
          {writeResult.samples.length > 1 && (
            <TimeSeriesChart
              series={[
                {
                  key: 'write',
                  label: 'Write',
                  color: COLORS.green,
                  points: writeResult.samples.map((s) => ({ ts: s.elapsedSeconds, value: s.mbPerSecond })),
                },
              ]}
              formatTs={formatElapsed}
              formatValue={formatMbPerSecond}
              height={120}
            />
          )}
        </>
      )}
      {writeError && <div className="status-note status-note--error">{writeError}</div>}
    </div>
  );
}
