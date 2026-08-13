import type Database from 'better-sqlite3';
import { config } from '../config.js';
import type { MetricName, MetricSeries } from './types.js';

interface SampleInput {
  metric: MetricName;
  key: string;
  value: number;
}

interface SampleRow {
  ts: number;
  key: string;
  value: number;
}

/** Owns metrics.db (see db.ts) — the sampler writes through this, the /metrics route reads through this. */
export class MetricsService {
  private insertStmt: Database.Statement;
  private queryStmt: Database.Statement;
  private pruneStmt: Database.Statement;
  private insertTx: Database.Transaction;

  constructor(private db: Database.Database) {
    this.insertStmt = db.prepare('INSERT INTO samples (ts, metric, key, value) VALUES (?, ?, ?, ?)');
    this.queryStmt = db.prepare('SELECT ts, key, value FROM samples WHERE metric = ? AND ts >= ? ORDER BY key, ts');
    this.pruneStmt = db.prepare('DELETE FROM samples WHERE ts < ?');
    this.insertTx = db.transaction((rows: SampleInput[], ts: number) => {
      for (const r of rows) this.insertStmt.run(ts, r.metric, r.key, r.value);
    });
  }

  /** One write transaction per sampler tick, not one per metric — keeps a multi-metric tick to a single fsync. */
  recordBatch(samples: SampleInput[], ts: number = Date.now()): void {
    if (samples.length === 0) return;
    this.insertTx(samples, ts);
  }

  /** WAL mode (see db.ts) means recent writes can sit in metrics.db-wal, not yet folded into
   *  metrics.db itself — a backup that only archives metrics.db would silently miss them, and a
   *  restore has no sane way to bring back matching -wal/-shm sidecars for a *different* database
   *  transplanted from another point in time anyway. TRUNCATE folds everything in and drops the
   *  WAL file back to empty, so the plain .db file is a complete, self-contained snapshot on its
   *  own — called right before every backup (system.ts's manual route, BackupScheduler's runs). */
  checkpointForBackup(): void {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }

  /** All series for one metric since `sinceMs`, split by key (e.g. one series per disk slot). */
  query(metric: MetricName, sinceMs: number): MetricSeries[] {
    const rows = this.queryStmt.all(metric, sinceMs) as SampleRow[];
    const byKey = new Map<string, MetricSeries['points']>();
    for (const row of rows) {
      const points = byKey.get(row.key) ?? [];
      points.push({ ts: row.ts, value: row.value });
      byKey.set(row.key, points);
    }
    return [...byKey.entries()].map(([key, points]) => ({ metric, key, points }));
  }

  prune(retentionMs: number = config.metricsRetentionDays * 24 * 60 * 60 * 1000): void {
    this.pruneStmt.run(Date.now() - retentionMs);
  }
}
