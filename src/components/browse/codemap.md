# src/components/browse/

## Responsibility

File-browser interaction components: path breadcrumbs, multi-select bulk actions, and the small modal dialogs for new-folder/rename/copy/move plus bulk-job progress.

## Design

- All components are controlled and stateless; the parent (`BrowsePage` via the `useBrowse` hook) owns the path, selection, and bulk-job state and passes callbacks.
- `Breadcrumbs` rebuilds the clickable path from a `/mnt/...` string, splitting on `/` and calling `onNavigate` per segment.
- `BulkActionBar` replaces the toolbar while a selection is active; its Delete button is a two-click confirm.
- `NewFolderModal` and `RenameModal` share the same shape: name validation (no slashes, not `.`/`..`), async `onSubmit(name) => Promise<boolean>` with failure message handled locally.
- `TransferModal` collects a destination (via `shared/PathAutocomplete`, scope `browse`) and hands off through `onStart(destPath)`; the actual transfer runs asynchronously and is tracked elsewhere, not by the modal.
- `BulkProgressDialog` renders a `BulkJobState` (from `useBrowse`) across running (percent + current item + Cancel), aborted, and result (succeeded/failed lists) states; it's dismissible only once not running.

## Flow

Selection in `useBrowse` toggles `BulkActionBar` vs the normal toolbar; Copy/Move open `TransferModal`, and the resulting `bulkJob` surfaces as `BulkProgressDialog` until dismissed. New Folder/Rename call their page-supplied `onSubmit` and report success back to the caller.

## Integration

Mounted from `BrowsePage`. Depends on `useBrowse` (state + `BulkJobState` type) and `shared/PathAutocomplete`. Styling in `src/styles/browse.css` and `dialog.css`.
