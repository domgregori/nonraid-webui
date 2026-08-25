# backend/src/routes/

## Responsibility
The HTTP layer of the backend: 24 router-factory files, each exporting one `xxxRouter(deps): Router` that translates REST calls into service/nmd client calls and formats responses.

## Design
- Every file is a factory function taking its concrete dependencies; `index.ts` constructs services first, then mounts each router at `/api`. `authRouter` is mounted before the `requireAuth` gate (setup/login/status/logout and 2FA-pending paths are public by design); all 23 others sit behind `app.use(requireAuth(authService))`.
- Error convention (per handler, never a global error middleware): `HttpError` → its own status; anything else → `502 {error}`. A few endpoints add a machine-readable `code` — `status.ts` returns `ARRAY_NOT_CONFIGURED` (404), and system/rclone restore routes use `passwordErrorCode`.
- Long-running operations stream newline-delimited JSON (`Content-Type: application/x-ndjson`) via `send({type:'progress'|'done'|'error'})` — apps install, docker storage-migrate/container create+edit, lxc storage-migrate/create, browse bulk. Failures after streaming starts arrive as an `error` event, not an HTTP status.
- Self-restart pattern (`routes/services.ts` webui-restart, `tls.ts` enable/disable, `system.ts` timezone/restart-services): respond first, then `process.exit(1)` on `res.on('finish')`, relying on the unit's `Restart=on-failure` to come back.
- Upload-then-commit flows (`array.ts` superblock import, `tls.ts` cert import, `system.ts` config restore): multer streams to `os.tmpdir()`, an in-memory token map stages the file with a 30-min lazy sweep, and the commit endpoint re-validates against live state rather than trusting the preview response.
- Client-supplied device paths and container names are always re-validated against fresh `nmd.listAvailableDevices()` / name-regex checks before they reach a shell (disks, smart, lxc, diskQueue).

## Flow
Request → `cors` + `express.json()` → `/api/health`, static frontend, then auth routes → `requireAuth` cookie check (401) → feature handler: validate body (throw `HttpError` 400), call the service, respond with JSON or an NDJSON stream. Mutating handlers log to `ActivityStore` and fire `notifyEvent()` for catalog events (diskAdded, parityStarted, arrayStarted/Stopped...).

## Integration
Consumes every backend domain — auth, activity, settings, tls, metrics, rclone, apps — plus the lower-level clients (nmd, docker, lxc, smart, shares, cache, system). Mounted in `backend/src/index.ts`; the frontend consumes the resulting endpoints (documented in `backend/API.md`).
