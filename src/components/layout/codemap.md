# src/components/layout/

## Responsibility

The persistent application shell: header with array status and notifications, primary navigation, footer, global toast stack, and the two globally-mounted overlays (`DiskDetailPanel`, `ArrayStopBlockedModal`).

## Design

- `AppShell` is the composition root: `<Header /> <NavTabs /> <ToastStack /> {children} <Footer /> <DiskDetailPanel /> <ArrayStopBlockedModal />`.
- `Header` composes the brand (`Link` + `HeaderClock`), `HeaderSystemInfo`, `ArrayStatusPill`, the array start/stop button (colored via `deriveToggleButton`), `NotificationBell`, and a logout button.
- `HeaderClock` ticks every 15s and renders the NAS-configured timezone (from `useSystemStats`) using the 12h/24h preference from `useSettings`.
- `HeaderSystemInfo` shows hostname, uptime, free array capacity, CPU%, and mem% from `useSystemStats` + `useArrayStatus`/selectors.
- `NavTabs` renders the ten top-level `NavLink` routes (Dashboard, Disks, Pools, Browse, Sharing, Docker, LXC, Apps, History, Settings).
- `NotificationBell` owns a click-outside dropdown of the `useNotifications` feed (unread count badge, mark-all-read on open) and opens `ActivityHistoryDialog` for "View all".
- `ToastStack` renders the notifications context's amber/red toasts as a fixed viewport-relative stack.
- `ArrayStatusPill` uses `deriveArrayStatus`; when the array is degraded (`isDegraded`) it becomes clickable and opens `ArrayHealthDialog`, which lists `deriveDegradedReasons` and offers a parity-check fix or a "View Disk" jump.

## Flow

Header pulls live array status/notifications/system stats from shared context/hooks and re-renders on each poll. `ArrayHealthDialog`'s "View Disk" calls `selectDisk(diskId)`, which opens the globally-mounted `DiskDetailPanel`. `ArrayStopBlockedModal` surfaces the `stopBlockedByContainers` state from `useArrayStatus` wherever the stop was triggered.

## Integration

`AppShell` mounted once in `App.tsx`; wraps every routed page. Depends on `useArrayStatus`, `useAuth`, `useNotifications`, `useSettings`, `useSystemStats`, `selectors/status`, `activity/ActivityHistoryDialog`, `disk-detail/DiskDetailPanel`, and `shared/ArrayStopBlockedModal`. Styling in `src/styles/layout.css`.
