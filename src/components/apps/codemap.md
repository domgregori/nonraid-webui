# src/components/apps/

## Responsibility

The Community Applications catalog UI: grid cards, detail panel, and the template-driven install flow.

## Design

- `AppCard` renders an app summary (icon via `AppIcon`, categories with a "+N" overflow, compact download/star stats, privileged badge, installed/update-available badges) and is keyboard-activatable (`role="button"`).
- `AppIcon` loads a hosted icon URL and falls back to a letter avatar on error; `AppDetailPanel` also uses it at larger size.
- `AppDetailPanel` fetches the full `CaApp` (`appsApi.getApp`) and defensively coerces every catalog value through `asText()`, since XML-derived fields can nest objects at runtime and a raw object child would unmount the whole page. Offers Install, Support/Source links, namespace filter ("All apps").
- `InstallDialog` runs the same stage machine as the Docker dialog (`loading` / `editing` / `reviewed` / `installing` / `done` / `load-error`). Template `Config` entries render through `ConfigField` keyed by type: `Path` uses `PathAutocomplete`, `Device` uses a curated picker with the `DEVICE_CUSTOM` fallback, `Port`/masked fields are numeric/password inputs. Hidden/advanced entries are filtered; `preReviewElevatedReasons` mirrors the backend's elevated-access list so the warning banner can show before first review.
- Review step (`appsApi.planInstall`) shows image/network/ports/volumes/env (masked values) and the resolved Web UI link; install streams through the shared `InstallProgress`.

## Flow

`AppsPage` renders the card grid (search/namespace filtering), opens `AppDetailPanel` on card click, and `InstallDialog` on install; `onInstall`/`onViewNamespace` callbacks route back to the page. `handleInstall` calls `appsApi.install` with an `onProgress` callback feeding `useInstallProgress`.

## Integration

Mounted from `AppsPage`. Uses `appsApi`, `dockerApi.listDevices`, `useInstallProgress`, `shared/PathAutocomplete`, and `docker/InstallProgress`. Styling in `src/styles/apps.css`.
