# backend/src/tailscale/

## Responsibility
Manage the `tailscale` daemon from the dashboard: status reporting, login (including a custom Headscale `--login-server`), logout, and runtime option changes.

## Design
- `client.ts` defines the `TailscaleClient` interface (`getStatus`, `login`, `logout`, `setOptions`) — a thin wrapper over an external always-on daemon's CLI, deliberately shaped like `rclone/client.ts`.
- `realClient.ts` (`RealTailscaleClient`): `getStatus` runs `tailscale status --json` plus `tailscale debug prefs` and projects the small field subset this app reads (installed, backendState, loggedIn, hostname, dnsName, IPs, tailnet, ssh, acceptDns, advertiseRoutes, acceptRoutes). `ENOENT` → `installed: false`; a stopped daemon → `installed: true, backendState: 'Stopped'`; unreadable prefs fall back to defaults — none of these are thrown as errors.
- `login()` spawns `tailscale up` (with `--login-server=<url>` when given) and resolves as soon as a URL is captured from stdout/stderr (20s timeout), returning `{ authUrl }`. The child is deliberately left running and unref'd so it can finish the browser handshake; the frontend polls `GET /tailscale/status` until `backendState` flips to `Running`. Exit code 0 with no URL means already authenticated.
- Feature gate: `settings.tailscale.enabled` lives in `settings.json` (just the toggle + remembered `loginServer`; everything else is read live from the daemon). `routes/tailscale.ts` `PUT /tailscale/enabled` additionally runs `systemctl enable/disable --now tailscaled`, best-effort so a host without the package can still save the preference.

## Flow
`GET /tailscale/status` → `client.getStatus()` merged with `featureEnabled`/`loginServer`. `POST /tailscale/login` → persist the login-server preference, spawn `up`, return `authUrl`. `POST /tailscale/logout` → `tailscale logout`. `PUT /tailscale/options` → validate each field, then `tailscale set --hostname/--ssh/--accept-dns/--advertise-routes/--accept-routes`.

## Integration
Consumed by `routes/tailscale.ts`; `index.ts` creates it via `createTailscaleClient()`. Depends on `settings` (toggle/loginServer), `activity`, and `system/procUtil` (`runSudoMaybe` for the systemctl toggle).
