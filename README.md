# nonraid-webui

A web dashboard for [nonraid](https://github.com/qvr/nonraid) / `nmdctl` — an unRAID-style storage
array driver + CLI. Surfaces array status, parity protection, per-disk detail, shares, users, Docker
containers, historical metrics (via Grafana), and array settings.

Two-part repo: a React frontend (this directory) and an Express backend (`backend/`) that wraps
`nmdctl`, the Docker Engine API, `smartctl`, mergerfs/Samba/NFS (shares), and host CPU/memory.
**Dashboard, Docker, and Sharing pages are wired to the real backend** (polling, with mock fallbacks
when nonraid/Docker/smartmontools/mergerfs aren't available — see `backend/README.md`). Users/History/
Settings and the Dashboard sidebar's Activity feed are still mock-only — there's no backend concept
for any of those yet.

## Stack

- Frontend: React 19 + TypeScript, Vite, react-router-dom (routes: `/`, `/shares`, `/users`,
  `/docker`, `/history`, `/settings`). Plain CSS with a token file (`src/styles/tokens.css`) — no
  CSS-in-JS, no component library.
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

Run both, then open the frontend — Dashboard, Docker, and Sharing will show live data. Real mode is
the default everywhere; the backend only uses mock data for a part when you set that part's mode to
`mock` by hand.

See `backend/README.md` for the API and configuration.

## Project layout

```
src/
  types/       domain types (Disk, Parity, Container, User, Settings, ...) +
               nmdApi.ts/dockerApi.ts/sharesApi.ts/systemApi.ts (mirror the backend's wire types)
  api/         fetch wrappers for the backend (nmdApi, dockerApi, smartApi, sharesApi, systemApi)
  mock/        hardcoded mock data for still-unwired pages (users, activity log)
  state/       AppStoreProvider (settings + Grafana URL, local-only) and
               ArrayStatusProvider (polls the backend for array/parity/disk/temp state,
               owns disk-detail selection — this is the real one)
  hooks/       useDockerContainers, useShares, useSystemStats — polling hooks with
               create/update/remove actions where relevant
  selectors/   pure derivation functions (backend response -> view models)
  components/  layout, dashboard, disk-detail, shares (create/edit form), shared UI primitives
  pages/       one component per route
  styles/      CSS token file + per-area stylesheets

backend/                 Express API wrapping nmdctl, Docker, smartctl, shares, and system stats
  src/nmd/     NmdClient interface + RealNmdClient (shells out to nmdctl) + MockNmdClient
  src/docker/  DockerClient interface + RealDockerClient (dockerode) + MockDockerClient
  src/smart/   SmartClient interface + RealSmartClient (smartctl) + MockSmartClient + caching service
  src/shares/  ShareStore (owns shares.json) + ShareApplier interface (mergerfs/Samba/NFS,
               real or mock) + ShareService (orchestrates both)
  src/system/  SystemStatsService (host CPU/memory via Node's os module — no mock variant, see
               backend/README.md for why)
  src/routes/  /api/status, /api/array/*, /api/parity/*, /api/docker/*, /api/smart/*,
               /api/shares/*, /api/system
  testing/     Docker-based environment with real mergerfs/Samba to test Shares against
```

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
- Shares backend and frontend (create/edit/delete via a form modal, real mergerfs/Samba/NFS) are done
  and tested against `backend/testing/`'s real environment — see `backend/README.md`'s Shares section
  for what was actually verified.
- System card (CPU/Memory) and the header's hostname/uptime/CPU/mem are wired to `/api/system` — real
  host stats via Node's `os` module, confirmed live (values change between polls, not a static
  snapshot). Note this reports the **host's** stats, not container-scoped ones, if the backend runs
  inside a container (like `backend/testing/`'s).
