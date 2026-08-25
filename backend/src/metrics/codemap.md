# backend/src/metrics/

## Responsibility
Time-series history: a 60-second background sampler collects host and per-disk metrics into SQLite (better-sqlite3), and the History page queries them by metric name and time range.

## Design
- `db.ts`: `openMetricsDb` creates `samples(ts, metric, key, value)` with WAL journaling and `(metric, key, ts)` / `(ts)` indexes. The schema is deliberately long/narrow so adding a metric later is just a new `MetricName`, never a migration.
- `sampler.ts` (`MetricsSampler`): self-unref'd 60s timer. Each tick records cpu/mem (from `SystemStatsService`) and net rates, then — guarded by try/catch so a stopped array never loses host metrics — per-disk temperature/usage and I/O rates (diffing nmd's cumulative 8-sector-unit counters, 4096 bytes/unit, against the previous tick). Prunes retention once per 60 ticks rather than every tick.
- `service.ts` (`MetricsService`): prepared statements; the whole tick lands in a single insert transaction (one fsync); `query()` groups rows by key into `MetricSeries[]` (key `'total'` for host metrics, the disk slot string for per-disk ones); `checkpointForBackup()` runs `wal_checkpoint(TRUNCATE)` so a backed-up `metrics.db` is a self-contained snapshot.
- `net.ts`: `readNetTotals` sums `/proc/net/dev` bytes, excluding `lo`, `veth`, `docker`, and `br-*`; `NetRateTracker` diffs successive snapshots. Each consumer (the 60s sampler and the 3s live route) holds its own instance so cadences never perturb each other's delta math.
- `types.ts` enumerates the 8 `METRIC_NAMES`.

## Flow
Sampler tick → `system.getStats()` + net sample + `nmd.getStatus()` + SMART temps → `recordBatch(samples, now)` → every 60th tick `prune()`. `GET /metrics?metrics=cpu_percent,...&range=24h` validates names and the `RANGE_MS` map, then returns `{ series }` per metric via `metrics.query(m, sinceMs)`. `checkpointForBackup()` runs before every config backup (`routes/system.ts`, `BackupScheduler`).

## Integration
Consumed by `routes/metrics.ts` and `routes/system.ts` (its own `NetRateTracker` for `/system/net-live`, and the backup checkpoint). Depends on `system` (stats), `nmd` (status), and `smart` (temperatures).
