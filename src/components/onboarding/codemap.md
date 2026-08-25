# src/components/onboarding/

## Responsibility

First-run setup: deciding whether the wizard opens at all, the multi-step wizard itself, the minimal array builder, and the remote-restore entry point.

## Design

- `OnboardingGate` sits between `AuthGate`'s providers and `App` (which stays mounted underneath). It auto-opens the wizard at most once per load when the array is genuinely unconfigured (`loadState === 'not-configured'` or `total_slots === 0` with `loadState === 'ready'`) and the `onboarding.dismissed` setting is false; it also provides `OnboardingContext.replay` for Settings' "Replay setup tour".
- `OnboardingWizard` derives its start step from live array state (`deriveStartStep` on `hasAnyDisk`/`hasDataDisk`, computed from `status.disks`, not `total_slots`), so a reload or replay resumes at the right place. Steps: `welcome` (hostname/timezone, first-run only) -> `start` (build/import/restore choices) -> `import`/`restoreConfig`/`disks` -> `info` (5-slide tour) -> `done`. Step resolution after a commit uses `refresh()`'s return value to avoid stale closures.
- `ArrayBuilder` deliberately offers only a parity pick and a data pick (nmdctl hard-refuses more ambitious plans); it guards `parityTooSmall`, then sequentially calls `nmdApi.addDisk` (slot 0, then slot 1), `startArray`, and `parityCheck('CORRECT')` to kick off the initial build, appending `nmdctl` output to a build log.
- `RemoteRestoreOnboarding` gets a fresh install from "nothing configured" to `RestoreFromRemoteWizard`'s `browsePath` mode: enables rclone (`setEnabled(true)`), lists providers/remotes, connects via `AddRemoteForm` if needed, takes a remote path, then hands off.

## Flow

`OnboardingGate` watches `loadState`/`status`/dismissed; `finish()` persists `onboarding.dismissed` and hides the wizard. Import/restore completions (`onImported`/`onRestored`) re-derive the live step so the wizard advances past the finished step.

## Integration

Mounted from `AuthGate` above `App`. Uses `useArrayStatus`, `useSystemStats`, `settingsApi`, `systemApi`, `useAvailableDevices`, and reuses `settings/ImportArrayWizard`, `settings/ConfigRestoreWizard`, `settings/RestoreFromLocalWizard`, `settings/RestoreFromRemoteWizard`, and `settings/AddRemoteForm`. Styling in `src/styles/onboarding.css`.
