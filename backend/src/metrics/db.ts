import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export function openMetricsDb(filePath: string = config.metricsDbPath): Database.Database {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS samples (
      ts INTEGER NOT NULL,
      metric TEXT NOT NULL,
      key TEXT NOT NULL,
      value REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_samples_metric_key_ts ON samples(metric, key, ts);
    CREATE INDEX IF NOT EXISTS idx_samples_ts ON samples(ts);
  `);
  return db;
}
