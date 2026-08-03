# nonraid-webui

A web dashboard for [nonraid](https://github.com/qvr/nonraid) / `nmdctl` — an unRAID-style storage
array driver + CLI. Surfaces array status, parity protection, per-disk detail, shares, users, Docker
containers, LXC containers, historical metrics (via Grafana), and array settings.

Two-part repo: a React frontend (this directory) and an Express backend (`backend/`) that wraps
`nmdctl`, the Docker Engine API, the `lxc-*` command-line tools, `smartctl`, mergerfs/Samba/NFS
(shares), and host CPU/memory. **Dashboard, Docker, LXC, Sharing, and Users pages are wired to the
real backend** (polling, with mock fallbacks when nonraid/Docker/liblxc/smartmontools/mergerfs/useradd
aren't available — see `backend/README.md`). History/Settings and the Dashboard sidebar's Activity
feed are still mock-only — there's no backend concept for any of those yet.

Users means SMB/NFS share accounts (real Linux/Samba users, uid/gid ≥ 20000), **not** a webui login
system — the API itself still has no auth layer at all (see `backend/README.md`'s Privileges section);
those are two separate, still-separate concerns.

## Stack

- Frontend: React 19 + TypeScript, Vite, react-router-dom (routes: `/`, `/shares`, `/browse`,
  `/users`, `/docker`, `/lxc`, `/apps`, `/history`, `/settings`). Plain CSS with a token file
  (`src/styles/tokens.css`) — no CSS-in-JS, no component library.
- Backend: Node + TypeScript, Express. See `backend/README.md`.

## Getting started (frontend)

```bash
npm install
npm run dev
```

## Getting started (backend)

```bash
cd backend
npm install
npm run dev   # http://localhost:3001, real mode by default (see backend/README.md to set mock)
```

Run both, then open the frontend — Dashboard, Docker, Sharing, and Users will show live data. Real mode
is the default everywhere; the backend only uses mock data for a part when you set that part's mode to
`mock` by hand. Users' real mode needs root (`useradd`/`smbpasswd` family) — see
`backend/README.md`'s Privileges section. For a real end-to-end test environment (real kernel driver,
real array, real Samba/NFS), use a VM — see the main `nonraid` repo's development docs. There is no
Docker-based test environment for this project; don't reintroduce one.

See `backend/README.md` for the API and configuration.

## Project layout

```
src/
  types/       domain types (Disk, Parity, Container, Settings, ...) +
               nmdApi.ts/dockerApi.ts/sharesApi.ts/usersApi.ts/systemApi.ts (mirror the backend's
               wire types)
  api/         fetch wrappers for the backend (nmdApi, dockerApi, smartApi, sharesApi, usersApi,
               systemApi)
  mock/        hardcoded mock data for still-unwired pages (activity log)
  state/       AppStoreProvider (settings + Grafana URL, local-only) and
               ArrayStatusProvider (polls the backend for array/parity/disk/temp state,
               owns disk-detail selection — this is the real one)
  hooks/       useDockerContainers, useLxcContainers, useShares, useUsers, useGroups,
               useSystemStats — polling hooks with create/update/remove actions where relevant
  selectors/   pure derivation functions (backend response -> view models)
  components/  layout, dashboard, disk-detail, shares (create/edit form), users (add-user modal,
               groups modal, per-user detail panel with share-access grid), shared UI primitives
  pages/       one component per route
  styles/      CSS token file + per-area stylesheets

backend/                 Express API wrapping nmdctl, Docker, lxc-*, smartctl, shares, users, and
                         system stats
  src/nmd/     NmdClient interface + RealNmdClient (shells out to nmdctl) + MockNmdClient
  src/docker/  DockerClient interface + RealDockerClient (dockerode) + MockDockerClient
  src/lxc/     LxcClient interface + RealLxcClient (shells out to lxc-ls/lxc-info/lxc-create/...) +
               MockLxcClient + configFile.ts (line-based get/set against a container's real config
               file — its only metadata store) + statsPoller.ts (poll-and-cache CPU/mem/IPs)
  src/smart/   SmartClient interface + RealSmartClient (smartctl) + MockSmartClient + caching service
  src/shares/  ShareStore (owns shares.json) + ShareAccessStore (owns share-access.json, per-user/
               group SMB permissions) + ShareApplier interface (mergerfs/Samba/NFS, real or mock) +
               ShareService (orchestrates all three)
  src/users/   UsersClient interface + RealUsersClient (shells out to useradd/smbpasswd/etc., host
               /etc/passwd+/etc/group as source of truth) + MockUsersClient + UsersService
  src/system/  SystemStatsService (host CPU/memory via Node's os module — no mock variant, see
               backend/README.md for why)
  src/routes/  /api/status, /api/array/*, /api/parity/*, /api/docker/*, /api/lxc/*, /api/smart/*,
               /api/shares/*, /api/users/*, /api/groups/*, /api/system
```

There is no Docker-based test environment for this project. Real-mode testing (Shares, Users,
mergerfs, Samba) happens on a VM with the real NonRAID kernel driver — see the main `nonraid`
repo's development docs. Don't reintroduce a Docker test environment.

## Notes

- The frontend's demo scenario switcher (Healthy / Degraded / Parity Check) is gone — array/disk
  state is real now, driven by the backend.
- Disk temperature comes from `smartctl` via the backend's `/api/smart/temperatures`, merged into
  disk view models by device path — nmdctl itself has no concept of temperature.
- Turbo write / event notifications toggles on the Dashboard and Settings pages are **not** wired to
  `nmdctl set` yet — they still just flip local state. Same for the Activity feed — no backend event
  log source exists.
- Docker Engine API integration (containers page) is done. Grafana URL storage (history page) needs
  no backend beyond storing the URL, and isn't started.
- LXC containers page/backend is done for Phase 1 — lifecycle, create-from-download-template (live
  distro index + host bridge picker), and direct config-file editing. Verified end-to-end against a
  real VM with liblxc installed (real `lxc-create`, real DHCP IP via `lxcbr0`). Snapshots, backups,
  ZFS/BTRFS conversion, and a community-template catalog are deferred — see `backend/README.md`'s
  LXC section.
- Shares backend and frontend (create/edit/delete via a form modal, real mergerfs/Samba/NFS) are done
  and tested against a real VM environment — see `backend/README.md`'s Shares section for what was
  actually verified.
- Users backend and frontend (real Linux/Samba accounts at uid/gid ≥ 20000, groups, per-share
  read-write/read-only/none/hidden access) are done — see `backend/README.md`'s Users section for the
  `hidden` approximation caveat and what's deliberately out of scope for this first version (rename,
  quotas, API tokens, 2FA).
- System card (CPU/Memory) and the header's hostname/uptime/CPU/mem are wired to `/api/system` — real
  host stats via Node's `os` module, confirmed live (values change between polls, not a static
  snapshot).
