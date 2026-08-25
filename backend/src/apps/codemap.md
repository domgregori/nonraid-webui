# backend/src/apps/

## Responsibility
Community Applications integration: fetch and cache the large CA app feed, filter it down to installable Docker apps, and translate a CA template's XML config into a validated Docker install plan.

## Design
- `feedStore.ts` (`CaFeedStore`): fetches the ~20MB feed on startup (primary CDN URL, GitHub mirror fallback), persists it atomically to `config.appsFeedCachePath` so restarts don't re-fetch, refreshes on a long background interval, and dedupes concurrent refreshes via a single in-flight promise. An unreadable cache file triggers a re-fetch rather than crashing.
- `service.ts` (`AppsService`): every method reads through `applications()`, which excludes native OS `Plugin` entries (no install framework exists for them). `listSummaries` joins the feed against live Docker containers by the `com.nonraid.apps.name` label to mark installed apps and detect updates. `resolvePlan` turns each `Config` entry (Port/Variable/Path/Device/Label) into plan fields, validating port ranges, the bind-path allowlist (`config.appsBindRoots`), and device `/dev/` paths, then computes elevated-access reasons.
- `install()` rebuilds the plan from the request (never trusts a client-echoed plan), provisions allowed bind host dirs via `provisionArrayDir` (so Docker can't auto-create them as root:root), stamps `APP_NAME_LABEL`/`APP_REPOSITORY_LABEL` on the container, and streams progress through the Docker client callback.
- `webUi.ts`: resolves a template's `[PORT:n]` placeholders against actual port mappings; `[IP]` is left for the frontend to fill with `window.location.hostname`.
- The route (`routes/apps.ts`) wraps `install` in an NDJSON stream (`progress`/`done`/`error` events) since image pulls can take minutes.

## Flow
`caFeedStore.start()` at boot loads disk cache or fetches. `GET /apps` → search/category/sort → `listSummaries`. `POST /apps/:name/plan` → `buildPlan`. `POST /apps/:name/install` → `getApp` (matches Name + optional Repository, since names aren't unique) → `resolvePlan` → validate + `privilegedAck` check → provision dirs → `docker.createContainer` with progress events.

## Integration
Consumed by `routes/apps.ts` and by `routes/docker.ts` (reads the app labels to resolve a container's WebUI URL from the CA template; `/docker/devices` feeds the install dialog). Depends on `docker` (DockerClient, planning helpers), `config`, and `activity`.
