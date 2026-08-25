# src/components/activity/

## Responsibility

The full activity/history feed dialog - the "View all" destination from the header's notification bell.

## Design

- `ActivityHistoryDialog` is a dialog with a limit picker (20/50/100/200), a Refresh button, and a scrollable `.activity-list` of feed rows.
- Rows render the same markup the notification dropdown uses: a colored dot (`COLORS[entry.color]`), the entry text, and `formatRelativeTime(entry.timestamp)`.
- Data comes from the `useActivity(limit)` hook (backed by `activity.json`), so it can re-fetch with a different limit; the list scrolls to top whenever entries change.
- Loading/error/empty states are handled explicitly ("Nothing yet.").

## Flow

`NotificationBell`'s "View all" button opens the dialog; `onClose` unmounts it. `refresh` re-pulls the current limit's entries.

## Integration

Mounted from `layout/NotificationBell`. Uses `useActivity`, `COLORS`, and `formatRelativeTime`. Styling in `src/styles/history.css` (with `.activity-list` shared by the bell dropdown).
