# src/selectors/

## Responsibility
Pure, side-effect-free derivations that map wire types (from `src/types`) into display-ready view models, labels, and colors.

## Design
- Convention: exported `deriveXxx(...)` functions taking a wire object (plus context like `arrayStarted`, temps/health maps, or callback bundles) and returning a view model interface defined in `src/types` (`DiskViewModel`, `ParityViewModel`, `ContainerViewModel`, `LxcContainerViewModel`, `ShareViewModel`, `UserViewModel`).
- Display concerns are kept here, not in components: formatting (sizes, percentages, ETA strings, `formatBytesAsMB`), color selection via `COLORS`/`tint`, and label lookup tables (`STATUS_LABELS`, `STATE_LABEL`, `ALLOCATION_LABELS`, `PERMISSION_LABELS`, `LOCATION_TYPE_*`).
- `status.ts` holds the important business logic: `isDegraded` (guards against the driver's `isPhantomDegradedGlitch` — stale counters with every disk DISK_OK), `deriveDegradedReasons` (per-disk/missing/resync/`sync_errors` explanations), `deriveArrayStatus` (pill text/color incl. resync-action word detection: `clear`→CLEARING, `recon`→REBUILDING, else PARITY CHECK), `deriveProtection`, `deriveToggleButton`, `isArrayError`.
- `parity.ts` adds `needsDriverReload` detection for the stuck-pending-0-size counter bug.
- `disks.ts` exports `diskNeedsFormat` (shared by card border + dashboard summary), `deriveDisk`, `deriveDisks` (parity/data/all split), `deriveCapacity`, `deriveDisksOnline`.
- `containers.ts`/`lxcContainers.ts` return full view models and fold in action callbacks passed by the page (`ContainerActions`, `LxcContainerActions`); `containers.ts` also resolves `webUiUrl` (replacing `[IP]` with `window.location.hostname`) and distinguishes crash-loop/OOM/nonzero-exit stopped states.
- `shares.ts`/`users.ts`/`services.ts`/`browse.ts` are label/color/endpoint derivations (`deriveShareEndpoints` builds `smb://`/`nfs://host/name` from the current hostname).

## Flow
Pages and components call `data.map(deriveXxx)` (or `deriveXxx(singleItem, deps)`) at render time and feed the results into view components. Because they are pure, re-rendering on a fresh poll just re-derives.

## Integration
- Import `src/styles/colors` (`COLORS`, `tint`) and `src/utils/format` (`formatBytesAsMB`, `formatBytesHuman`) and view-model types from `src/types` (via `src/types/index.ts`).
- Consumed by `src/pages/*` (SharesPage, DockerPage, LxcPage, BrowsePage, UsersPage, SettingsPage, HistoryPage) and components (`components/dashboard/*`, `components/disk-detail/*`, `components/layout/ArrayHealthDialog`).
