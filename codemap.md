# nonraid-webui/ (Repository Atlas)

## Project Responsibility
A self-hosted NAS dashboard for the [NonRAID](https://github.com/qvr/nonraid) kernel driver (an Unraid alternative): array/parity status, per-disk detail, shares (mergerfs/Samba/NFS), users/groups, Docker + LXC containers, a Community-Applications app catalog, historical metrics, backups, notifications, and system management. Two apps in one repo — a React 19 + Vite frontend (`src/`) and an Express + TypeScript backend (`backend/`) that runs as root and shells out to `nmdctl`, Docker, LXC, `smartctl`, `mergerfs`, Samba, NFS, `useradd`/`smbpasswd`, Apprise, Tailscale, and rclone. Deployed as a single appliance by `tools/install-webui.sh`.

## System Entry Points
- `src/main.tsx` — frontend root: `createRoot` + `BrowserRouter` + `AuthProvider` + `AuthGate`.
- `src/AuthGate.tsx` — single auth branch: Setup → Login → authenticated app (nested providers + router).
- `backend/src/index.ts` — backend composition root: constructs every service (constructor DI), mounts routes under `/api` behind `requireAuth`, optionally serves the built frontend + terminates TLS.
- `backend/src/config.ts` — all ~50 config knobs (env > TOML > default precedence).
- `tools/install-webui.sh` — the installer/updater that provisions the host and stages both halves to `/opt/nonraid-webui`.
- `package.json` (root) / `backend/package.json` — frontend/backend manifests and build scripts.

## Architecture Summary
- **Frontend data flow**: `src/api/*` fetch wrappers (all funnel through `request.ts`) → `src/state/*` providers poll the backend → `src/selectors/*` derive view models → `src/pages/*` compose `src/components/*`. The `ArrayStatusProvider` is the heartbeat (polls `nmdApi.getStatus()` every 2s).
- **Backend data flow**: `routes/*` (router factory fns) → `*/service.ts` + `*/client.ts` interfaces → `*/realClient.ts` shell-out implementations (`execFile` with argv arrays, never shell strings). Errors surface as `new Error(stderr || stdout || message)`; routes map `HttpError`→status, else 502 `{error}`, some with machine-readable `code`.
- **Styling**: `src/styles/tokens.css` (oklch CSS custom properties, light/dark) + per-area stylesheets; kebab-case BEM-ish class names.

## Directory Map (Aggregated)

### Frontend (`src/`)
| Directory | Responsibility | Detailed Map |
|-----------|----------------|--------------|
| `src/` | Frontend root: entry, auth gate, router, CSS import. | [Map](src/codemap.md) |
| `src/api/` | Fetch wrappers per backend domain (via `request.ts`, `progressStream.ts`). | [Map](src/api/codemap.md) |
| `src/hooks/` | Polling/action hooks (useEffect + setInterval pattern). | [Map](src/hooks/codemap.md) |
| `src/pages/` | One component per route. | [Map](src/pages/codemap.md) |
| `src/selectors/` | Pure backend-response → view-model derivations. | [Map](src/selectors/codemap.md) |
| `src/state/` | Providers/contexts (ArrayStatusProvider heartbeat, Auth, Settings, Notifications). | [Map](src/state/codemap.md) |
| `src/types/` | Domain wire types mirroring the backend. | [Map](src/types/codemap.md) |
| `src/utils/` | `format.ts` display helpers, `webauthnSupport.ts`. | [Map](src/utils/codemap.md) |
| `src/styles/` | CSS tokens + per-area stylesheets. | [Map](src/styles/codemap.md) |
| `src/assets/` | Static assets. | [Map](src/assets/codemap.md) |
| `src/components/` | Component tree overview. | [Map](src/components/codemap.md) |
| `src/components/layout/` | AppShell, Header, NavTabs, NotificationBell, ArrayStatusPill. | [Map](src/components/layout/codemap.md) |
| `src/components/dashboard/` | StatCards, DiskCard, ArrayDisks, widget cards. | [Map](src/components/dashboard/codemap.md) |
| `src/components/disk-detail/` | DiskDetailPanel, add/replace/cache dialogs, SMART, benchmark. | [Map](src/components/disk-detail/codemap.md) |
| `src/components/docker/` | ContainerFormDialog, InstallProgress, LogsDialog. | [Map](src/components/docker/codemap.md) |
| `src/components/lxc/` | CreateLxcDialog, EditLxcConfigDialog, SnapshotsDialog. | [Map](src/components/lxc/codemap.md) |
| `src/components/apps/` | AppCard, AppDetailPanel, InstallDialog. | [Map](src/components/apps/codemap.md) |
| `src/components/browse/` | Breadcrumbs, BulkActionBar, transfer/modals. | [Map](src/components/browse/codemap.md) |
| `src/components/shares/` | ShareFormModal, ShareExportModal. | [Map](src/components/shares/codemap.md) |
| `src/components/users/` | AddUser/AddGroup modals, user/group detail panels. | [Map](src/components/users/codemap.md) |
| `src/components/settings/` | TLS, 2FA, passkey, Tailscale, backups, services, logs, restore wizards. | [Map](src/components/settings/codemap.md) |
| `src/components/onboarding/` | OnboardingWizard, ArrayBuilder, RemoteRestoreOnboarding. | [Map](src/components/onboarding/codemap.md) |
| `src/components/auth/` | TwoFactorStep. | [Map](src/components/auth/codemap.md) |
| `src/components/activity/` | ActivityHistoryDialog. | [Map](src/components/activity/codemap.md) |
| `src/components/shared/` | Card, ProgressBar, ToggleSwitch, TimeSeriesChart, PathAutocomplete. | [Map](src/components/shared/codemap.md) |

### Backend (`backend/`)
| Directory | Responsibility | Detailed Map |
|-----------|----------------|--------------|
| `backend/` | Package/manifest root; build pipeline; runtime JSON/SQLite state. | [Map](backend/codemap.md) |
| `backend/scripts/` | `gen-build-info.mjs` bakes git short-hash into a generated source file. | [Map](backend/scripts/codemap.md) |
| `backend/src/` | Composition root: `index.ts` wiring, `config.ts`, `httpError.ts`. | [Map](backend/src/codemap.md) |
| `backend/src/nmd/` | NmdClient → `nmdctl` (array status/start/stop/shrink/import). | [Map](backend/src/nmd/codemap.md) |
| `backend/src/docker/` | DockerClient (dockerode) + container planning/devices/storage. | [Map](backend/src/docker/codemap.md) |
| `backend/src/lxc/` | LxcClient (lxc-* tools) + config-file editing + stats poller. | [Map](backend/src/lxc/codemap.md) |
| `backend/src/smart/` | SmartClient (`smartctl`) + caching SmartService. | [Map](backend/src/smart/codemap.md) |
| `backend/src/system/` | SystemStatsService, logs, services, host config, backups. | [Map](backend/src/system/codemap.md) |
| `backend/src/shares/` | ShareStore/ShareAccessStore + ShareService (mergerfs/SMB/NFS). | [Map](backend/src/shares/codemap.md) |
| `backend/src/shares/applier/` | RealShareApplier: managed-block writes to mount/smb.conf/exports. | [Map](backend/src/shares/applier/codemap.md) |
| `backend/src/users/` | RealUsersClient (useradd/smbpasswd; /etc/passwd source of truth). | [Map](backend/src/users/codemap.md) |
| `backend/src/browse/` | File browser ops under `/mnt` + path safety. | [Map](backend/src/browse/codemap.md) |
| `backend/src/cache/` | btrfs RAID1 cache pool + scheduled mover. | [Map](backend/src/cache/codemap.md) |
| `backend/src/diskQueue/` | Serializes array stop/start around add-disk. | [Map](backend/src/diskQueue/codemap.md) |
| `backend/src/emptyDisk/` | Evict a disk's data before removal. | [Map](backend/src/emptyDisk/codemap.md) |
| `backend/src/fileMove/` | Move/copy primitives shared by Browse and diskQueue. | [Map](backend/src/fileMove/codemap.md) |
| `backend/src/routes/` | 24 router factories mounted under `/api` behind `requireAuth`. | [Map](backend/src/routes/codemap.md) |
| `backend/src/auth/` | Sessions, hashing, rate limiting, TOTP/passkey, `requireAuth`. | [Map](backend/src/auth/codemap.md) |
| `backend/src/tls/` | Self-signed cert generation + imported cert inspection. | [Map](backend/src/tls/codemap.md) |
| `backend/src/apps/` | Community Applications feed + one-click Docker installs. | [Map](backend/src/apps/codemap.md) |
| `backend/src/metrics/` | CPU/mem/disk/net sampling + SQLite history store. | [Map](backend/src/metrics/codemap.md) |
| `backend/src/parity/` | Scheduled parity-check trigger. | [Map](backend/src/parity/codemap.md) |
| `backend/src/settings/` | Settings store + Apprise notification catalog/dispatch. | [Map](backend/src/settings/codemap.md) |
| `backend/src/activity/` | Event log store + passive change watcher. | [Map](backend/src/activity/codemap.md) |
| `backend/src/tailscale/` | Tailscale CLI client (live login-URL capture). | [Map](backend/src/tailscale/codemap.md) |
| `backend/src/rclone/` | rclone rcd HTTP client + sync jobs/scheduler. | [Map](backend/src/rclone/codemap.md) |

### Ops / Tooling (`tools/`)
| Directory | Responsibility | Detailed Map |
|-----------|----------------|--------------|
| `tools/` | Single-file installer/updater (`install-webui.sh`). | [Map](tools/codemap.md) |
| `tools/config/` | `config.toml.example`, `smb.conf`, Avahi service templates. | [Map](tools/config/codemap.md) |
| `tools/systemd/` | `nonraid-webui.service`, `rclone-rcd.service` units. | [Map](tools/systemd/codemap.md) |

## Key Conventions
- **Config precedence**: environment variable > TOML > hardcoded default (no `.env`).
- **No tests** in the repo; lint is oxlint only (`oxlint` script, `.oxlintrc.json`).
- **Safety-first shell-outs**: `execFile`/`spawn` with argv arrays (no shell-string injection); fail-loud on corrupt JSON state; managed marker blocks when editing system config (`smb.conf`, `/etc/exports`).
- **Backend TS** is `strict` + `noUncheckedIndexedAccess` (NodeNext ESM); **frontend TS** is bundler-mode (not strict), `tsc -b` drives the build.
