# src/components/lxc/

## Responsibility

LXC container management flows: creation with live progress, raw config editing, and snapshot management, plus bundled distro icon rendering.

## Design

- `CreateLxcDialog` stages through `loading-options` / `editing` / `creating` / `done` / `load-error`. Options (distros, bridges, interfaces, default arch) load via `Promise.all` of `lxcApi.listDistros/listBridges/listInterfaces`.
- The distro picker uses the `CUSTOM_VALUE` sentinel to expose a free-form distribution/release pair; `DistroIcon` renders the selected distro's bundled SVG mark inline in the picker.
- Network type (`bridge` vs `macvlan`) swaps the interface/bridge select list; `handleSubmit` streams `CreateLxcProgress` messages through an `onProgress` callback into a bounded log (`setLog(prev => [...prev.slice(-49), p.message])`).
- `EditLxcConfigDialog` edits the container's real on-disk config file directly (`lxcApi.getConfigText`/`setConfigText`) in a textarea - a restart picks up most changes.
- `SnapshotsDialog` lists snapshots via `lxcApi.listSnapshots` and supports create (stopped container only), restore-in-place, restore-as-new (new name prompt), and delete, each with a two-click confirm; row state is reset via `resetRowState`.
- `DistroIcon` resolves bundled inline SVG paths from `distroIcons.ts` (simple-icons CC0 marks keyed by this app's distribution strings) and falls back to a letter badge for unknown/custom distros.
- `distroIcons.ts` is a pure data module: `DISTRO_ICONS` map plus `findDistroIcon`.

## Flow

`LxcPage` drives a `dialog` state union (add/edit/snapshots); every dialog calls `onDone` to trigger a container-list refresh. Snapshot actions refetch in place.

## Integration

Mounted from `LxcPage`; `DistroIcon` is also imported by `dashboard/LxcWidgetCard`. Uses `lxcApi` and `distroIcons.ts`. Styling in `src/styles/docker.css`/`lxc` styles.
