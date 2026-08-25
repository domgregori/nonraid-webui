# backend/src/

## Responsibility
The whole-server wiring diagram. `index.ts` is a single async `main()` that constructs every service (constructor dependency injection) and then bootstraps Express. `config.ts` resolves the one shared config object. `httpError.ts` defines `HttpError`, the uniform way domain layers carry an HTTP status up to the API layer.

## Design
- **Composition root, no service locator**: `main()` (index.ts) builds everything top-down and passes dependencies via constructors. Infrastructure is obtained through interface-returning factories: `createNmdClient()`, `createDockerClient()`, `createLxcClient()`, `createSmartClient()`, `createRcloneClient()`, `createTailscaleClient()`, `createUsersClient()`, `createShareApplier()` — routes only ever see the interface type.
- **config.ts precedence**: every key resolves env var > TOML > hardcoded fallback via `str`/`optStr`/`num`/`bool`/`strArray`. TOML is loaded once from `$HOME/.config/nonraid/config.toml` or `/etc/nonraid/config.toml` (first found wins; a file that exists but fails to parse throws at boot). Env stays authoritative for ad-hoc overrides.
- **Fail-fast boot**: `await authStore.get()` and `await tlsStore.get()` reject on corrupt JSON; a missing `index.html` while `serveFrontend` is true also aborts.
- **Persisted-state reapply before serving**: turbo-write, `trustProxy`, relocated LXC path, cache mirror remount, then `shares.remountAll()` — none of these survive a backend restart on their own.
- **Express bootstrap order**: CORS + `express.json()` → `GET /api/health` → `authRouter` (public login/setup by design) → optional static frontend serving scoped away from `/api` paths by `isApiPath` → `app.use(requireAuth(authService))` gates everything after → all remaining routers mounted under `/api`.
- **Protocol chosen once at boot** from `tls.json`; cert/key read failure falls back to plain HTTP (never crash-loops an admin out of Settings). `cookieSecure`/`webauthnRpId`/`webauthnOrigin` are flipped only inside the success branch.
- **httpError.ts**: plain `HttpError extends Error` with a `status` field and `name = 'HttpError'`. No middleware of its own — routes translate it into JSON responses.

## Flow
`main()` → construct infrastructure clients (nmd, docker, lxc, smart) → construct dependent services (activity, settingsStore, cache, shareApplier/shareStore/shares, diskQueue, ActivityWatcher, ParityScheduler, metrics, rclone, backupScheduler, authService, tlsStore, tailscale, browse, emptyDisk, cacheMover, system, users, apps) → `MetricsSampler.start()` → reapply persisted runtime state → create Express app → mount routers → `server.listen(config.port)`.

## Integration
- `config` is imported by nearly every module (nmd, docker, lxc, smart, system, cache, shares, auth, tls, metrics, rclone, settings) for binaries, paths, timeouts, and feature flags.
- Every `routes/*` module receives its already-constructed services as function arguments from index.ts.
- `HttpError` is thrown by system, nmd, cache, lxc, smart, and docker layers; route handlers map `HttpError.status` to the response status.
