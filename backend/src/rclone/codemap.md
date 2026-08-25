# backend/src/rclone/

## Responsibility
Remote Backup: manage rclone remotes, define and schedule sync jobs, run the syncs, and feed archive restores into the shared config-restore flow — all over rclone's `rcd` remote-control daemon (HTTP `:5572`).

## Design
- `client.ts` defines the `RcloneClient` interface; `realClient.ts` implements it with Basic-auth POSTs to `config.rcloneRcUrl` via `rcCall()` (credentials from `rcCredentials.ts`, which parses the shared systemd `EnvironmentFile` `RCLONE_RC_USER`/`RCLONE_RC_PASS`, cached after first read, `null` when Remote Backup isn't set up). Two-step OAuth remote creation (`createRemote` → `authUrl` → `continueRemoteSetup`), `checkRemote` via `operations/about` (heuristic `authExpired`), and async jobs via `_async: true`.
- `syncJobStore.ts`: the user-defined `SyncJob` list persisted to `rclone-sync-jobs.json` (same atomic write-queue pattern as the other stores).
- `service.ts` (`RcloneService`): runs one job at a time (single-flight `running` lock). Three scopes — `'config'`/`'configAppdata'` build a fresh timestamped `tar.gz` from the shared system backup paths + a `.meta.json` sidecar, then `copy` it up; `'custom'` is a live mirror via `sync/sync` with rclone's `--backup-dir` pointing at `.nonraid-versions/`. Day-based retention (`keepDays`/`forever`) is enforced by listing + deleting via `operations/list`/`operations/deletefile`. `runJobNow` polls `job/status` every 2s and records last-run stats.
- `obscure.ts`: reimplements rclone's own `core/obscure` algorithm (AES-256-CFB, fixed non-secret key) so a scheduled run can `reveal()` a stored encryption password for `openssl enc` — the RC API has no reveal endpoint.
- `syncScheduler.ts`: per-job `lastFiredKey` ticker (feature-gated on `settings.remoteBackup.enabled`), running matched jobs sequentially since `runJobNow` refuses concurrency.
- Restore: `listBackupsAt`/`previewBackupAt` list archives (enriched from their remote `.meta.json` sidecars), download one plus its sidecar into staging, decrypt if needed, and produce the same staged restore-preview/commit token every other restore source uses.

## Flow
`PUT /rclone/enabled` → persist + `systemctl enable --now rclone-rcd`. Remote CRUD → `config/create|update|delete` / `checkRemote`. Job CRUD → `SyncJobStore`; `runJobNow` → build source → `startSync` (returns rclone `jobid`) → `pollUntilDone` → store stats → `enforceRetention` → `notifyEvent(backupCompleted|backupFailed)`. Scheduler tick matches each job's `scheduleMatches`/`scheduleFireKey`.

## Integration
Consumed by `routes/rclone.ts`; `index.ts` builds it via `createRcloneClient()` (also used by `BackupScheduler.reveal` and `settings/backupEncryption.obscure`). Depends on `settings`, `activity`, `nmd`, and the system backup helpers (`backupStream`, `backupMeta`, `backupCatalog`, `configRestore`).
