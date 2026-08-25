# backend/

## Responsibility
The Express + TypeScript API server that fronts every system tool the NAS relies on (`nmdctl`, Docker, LXC, `smartctl`, mergerfs/Samba/NFS, `useradd`/`smbpasswd`), and — in production — serves the built frontend from the same origin. This top-level folder is the package/manifest root; the actual source lives in `src/`.

## Design
- `package.json` (`name: nonraid-webui-backend`, `type: module`) defines the build: `predev`/`prebuild`/`pretypecheck` all run `scripts/gen-build-info.mjs` first (bakes the git short-hash into `src/buildInfo.generated.ts`), then `tsx watch src/index.ts` (dev) or `tsc -p tsconfig.json` (build).
- `tsconfig.json` — `strict: true` **and** `noUncheckedIndexedAccess: true`, NodeNext ESM (`.js` extension imports), `rootDir: src`, output to `dist/`.
- Key runtime deps: `express` (HTTP), `dockerode` (Docker), `better-sqlite3` (metrics), `smol-toml` (config), `@simplewebauthn/server` + `otplib` + `qrcode` (auth/2FA/passkey), `cors`, `multer` (file uploads).
- `data/` holds runtime JSON/SQLite state (`shares.json`, `share-access.json`, `settings.json`, `activity.json`, `metrics.db`, `ca-feed.json`) — source of truth for shares/access/settings/activity/metrics, owned by the corresponding stores, not hand-edited.

## Flow
Build: `gen-build-info.mjs` → `tsc` → `dist/index.js`. Runtime: `dist/index.js` reads config (env > TOML > default), constructs every service, mounts routes under `/api` behind `requireAuth`, and (if `SERVE_FRONTEND`) serves the frontend `dist` + SPA fallback.

## Integration
- Depends on the host tools installed by `tools/install-webui.sh` (nmdctl, docker.io, lxc-*, smartctl, samba, nfs, apprise, rclone, tailscale).
- Serves the frontend built by the root `vite` build when `serve_frontend = true`.
- See `backend/src/codemap.md` for the entry-point wiring and per-domain maps.
