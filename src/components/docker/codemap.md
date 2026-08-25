# src/components/docker/

## Responsibility

Docker container create/edit with plan review and live install progress, plus a container log viewer with live tail.

## Design

- `ContainerFormDialog` runs a stage machine (`loading` / `editing` / `reviewed` / `installing` / `done` / `load-error`). Edit mode preloads the current container via `dockerApi.inspectContainer`.
- Form sections (ports, env vars, volumes, devices) reuse a local generic `ListField<T>` with `updateAt`/`removeAt` immutable row helpers.
- Host bind paths use `shared/PathAutocomplete` (scope `binds`); the device picker falls back to free text through the `DEVICE_CUSTOM` sentinel, and the network picker unions Docker's `bridge`/`host`/`none` with `listNetworks()` plus a `NETWORK_CUSTOM` sentinel.
- Privileged/host-network/device passthrough surfaces the shared elevated-access banner gated by a `privilegedAck` checkbox (reasons come from the server's plan).
- `handleReview` calls `dockerApi.planContainer`; `handleSubmit` calls `createContainer`/`recreateContainer` streaming progress through `useInstallProgress`.
- `InstallProgress` renders the streamed percent/status + pull-log lines (auto-scrolled via `logRef`) and doubles as the shared progress view for the Apps install dialog.
- `LogsDialog` shows tail options (100/500/2000), manual refresh, and a 2s live poll using a `since` cursor + last-line dedupe; ANSI escapes are rendered through a memoized `AnsiUp` instance; scroll-following is conditional on being near the bottom.

## Flow

`DockerPage` opens the dialog for add/edit/logs; a successful submit calls `onDone` to refetch the container list. Logs re-poll only while Live is enabled.

## Integration

Mounted from `DockerPage`. Uses `dockerApi`, `useInstallProgress`; `InstallProgress` is also consumed by `apps/InstallDialog`. Styling in `src/styles/docker.css` and `apps.css`.
