# src/components/shares/

## Responsibility

Pool (share) creation/editing and SMB/NFS export toggles.

## Design

- `ShareFormModal` handles create (`initial === null`) and edit; it renders name, description, "Use all drives" `ToggleSwitch`, a per-disk checkbox grid, and the allocation-method select (most-free, fill-up, high-water, single-disk, cache-only). `cache-only` is disabled unless `useCacheStatus` reports a configured pool (mirrors the `/cache/enabled` fsUuid gate).
- Disk list stays in sync with the live array while "Use all drives" is on; `single-disk` forces exactly one pick (radio input), and `cache-only` hides the picker entirely.
- `validate()` enforces the name regex (1-32 chars, `[a-zA-Z0-9_-]`), duplicate-name checks against `existingNames`, and per-allocation disk requirements.
- On edit, SMB/NFS export settings pass through unchanged (they're managed on the Sharing tab); a new pool starts with no protocols.
- `ShareExportModal` toggles SMB (with public/guest flag) and NFS (read-only, allowed-hosts list) for an existing pool; it always submits the full `ShareInput` since the update route replaces rather than patches. It surfaces contextual notes when nothing is shared or SMB is non-public.

## Flow

`SharesPage`/`UsersPage` open the modals and provide `onSubmit(input) => Promise<boolean>`; on `false`, the modal shows "Request failed - see the page error banner".

## Integration

Mounted from `SharesPage` (create/edit) and `UsersPage` (export). Uses `useArrayStatus`, `useCacheStatus`, and `shared/ToggleSwitch`. Styling in `src/styles/shares.css`-related sheets.
