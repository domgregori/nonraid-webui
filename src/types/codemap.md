# src/types/

## Responsibility
All shared TypeScript types: backend wire types (one file per backend domain), view-model types for selectors, and a small barrel re-export.

## Design
- Files named after their api/domain (`nmdApi.ts`, `systemApi.ts`, `dockerApi.ts`, `lxcApi.ts`, `sharesApi.ts`, `usersApi.ts`, `appsApi.ts`, `browseApi.ts`, `cacheApi.ts`, `diskQueue.ts`, `emptyDisk.ts`, `metricsApi.ts`, `rcloneApi.ts`, `servicesApi.ts`, `smart.ts`, `tailscaleApi.ts`, `tlsApi.ts`, `activityApi.ts`, `authApi.ts`, `settingsApi.ts`, `storagePath.ts`, `benchmark.ts`) — mostly type-only modules mirroring `backend/src/*` shapes (headers say "Mirrors backend/… Keep in sync.").
- Domain types are the union of the backend's raw response payloads; e.g. `NmdStatusResponse` = `{ array: NmdArrayStatus, resync: NmdResyncStatus, disks: NmdDisk[] }`, with string-literal unions for status enums (`NmdDiskStatus`, `ArrayMdState`, `ServiceState`) widened with `(string & {})` so unknown backend tokens don't break compilation.
- Wire types are discriminated/guarded by doc comments for the exact backend semantics the UI keys off (e.g. `RestartServicesResult.docker` is null unless opted in, `BackupEncryption.hasPassword` vs write-only `password`).
- View models live separately: `disk.ts` (`DiskViewModel`, `DiskRole`/`DiskStatus`), `parity.ts` (`ParityViewModel`), `container.ts` (`ContainerViewModel`), `lxcContainer.ts` (`LxcContainerViewModel`); `index.ts` re-exports `./disk`, `./parity`, `./container` (this is what `selectors/` and components import from `../types`).
- Constants with runtime value also live here: `CA_APP_NAME_LABEL` / `CA_APP_REPOSITORY_LABEL` in `dockerApi.ts`.

## Flow
No runtime logic. `api/*` imports response types for generic return values; `selectors/*` import view-model types and build them from wire types; hooks/pages/components import both as needed. `index.ts` collapses the view-model imports to a single `../types` path.

## Integration
- Imported by `src/api/*`, `src/selectors/*`, `src/state/*`, `src/hooks/*`, `src/pages/*`, and `src/components/*`.
- Kept in sync with `backend/src/**` by convention (noted in each file's header comment).
