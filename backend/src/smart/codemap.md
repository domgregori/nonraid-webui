# backend/src/smart/

## Responsibility
SMART disk health: temperature, health self-assessment, full attribute/self-test snapshots, and starting self-tests. Shells out to `smartctl --json -a` and caches results so poll-heavy routes don't hammer the binary.

## Design
- **Interface in types.ts** (no separate client.ts): `SmartClient` → `RealSmartClient` (realClient.ts) + `SmartService` (service.ts) cache wrapper, assembled in index.ts as `new SmartService(createSmartClient())`.
- **`run()`**: `smartctl -n standby --json -a <device>` — `-n standby` never spins up a sleeping disk. smartctl's nonzero exit is a condition bitmask (bit 1 = standby skip), not a command failure, so stdout JSON is still parsed on failure and `spinState` becomes `'standby'`.
- **`devicePath()`** idempotently prepends `/dev/` (nmd's `device` fields are bare names like `sda1`).
- **Defensive extraction**: typed `SmartctlJson` + helpers (`extractTemperatureC`, `extractSelfTest`, `extractSelfTestHistory`, `extractRawAttributes`, `extractCapabilitiesInfo`, `formatWwn`, `extractRotationRpm`) cover both ATA and NVMe shapes; every field falls back to null/unknown rather than throwing, so an unexpected device shape degrades to "-" in the UI.
- **`SmartService` caching**: three per-device maps (`tempCache`, `healthCache`, `attrCache`) with per-device in-flight dedup. Stale-while-revalidate: a cached value is served immediately while a background refresh runs once past TTL; a first-ever request for a device awaits the real read so callers don't get a wall of nulls on cold start. Temp/health use `config.smartCacheTtlMs` (60s); attributes use the shorter `config.smartAttributesCacheTtlMs` (4s) so self-test progress shows up promptly.
- **`startSelfTest`** fires `smartctl -t <type>` (returns once the controller accepts the test) and drops the cached attributes so the next poll picks up `'running'` immediately.

## Flow
- routes/smart.ts, routes/disks.ts, and the system status path → `SmartService.getTemperatures/getHealthStatuses/getAttributes` → shared `getCached` (TTL + in-flight dedup) → `RealSmartClient` → smartctl subprocess → normalized `SmartAttributes` / `SmartHealth`.
- Cache miss: await the fetch when cold, fire-and-forget refresh when warm; a failed fetch caches the fallback (null) so a transient failure does not re-trigger on every poll.

## Integration
- Consumed by routes/smart.ts, routes/disks.ts, routes/status.ts, and injected into `SystemStatsService` (boot-disk temperature) and `CacheService` (cache pool health).
- config: `smartctlBin`, `smartTimeoutMs`, `smartCacheTtlMs`, `smartAttributesCacheTtlMs`.
