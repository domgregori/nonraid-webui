# src/components/users/

## Responsibility

User and group management: create modals plus detail panels for share permissions, group membership, password resets, and deletion.

## Design

- `AddUserModal` and `AddGroupModal` share a validated-form shape: username/group regex (`^[a-z_][a-z0-9_-]{0,31}$`), uniqueness against `existingUsernames`/`existingGroupNames`, password length (>= 8) and match checks; both submit via `onSubmit(input) => Promise<boolean>`.
- `UserDetailPanel` edits group membership and share access using a baseline-vs-draft pattern: `access` (last-saved) vs `draftAccess`, and `user.groups` vs `draftGroups`. `handleSave` writes groups via the page's `onUpdateGroups` then loops `usersApi.setAccess` for the changed entries; the Save button enables only when dirty (`sameGroups` comparison).
- `GroupDetailPanel` mirrors the pattern for per-share permission selects (read-write / read-only / none / hidden via `PERMISSION_LABELS`), saving changed entries via `groupsApi.setAccess`. Members are derived from the `users` prop (`User.groups`) so membership has a single source of truth.
- Both panels include a reset-password block (user) and a two-step "Remove" confirm that delegates to page-supplied `onDelete`/`onResetPassword` async callbacks; `pending` disables destructive controls.

## Flow

`UsersPage` owns list state via `useUsers`/`useGroups` and passes selected `user`/`group` plus callbacks; panels fetch share access per username/group on mount and on switch, resetting drafts to the freshly fetched baseline.

## Integration

Mounted from `UsersPage`. Uses `usersApi`/`groupsApi` and the `PERMISSION_LABELS` selector. Styling in `src/styles/users.css`.
