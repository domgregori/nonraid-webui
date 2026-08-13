import { useNotifications } from '../../state/useNotifications';
import { COLORS } from '../../styles/colors';

/** Fixed, viewport-relative popup stack for the notifications context's amber/red toasts — see
 *  NotificationsProvider for the toast-worthy filter and auto-dismiss timing. Mounted once,
 *  globally, in AppShell — same spot the old ArrayErrorBanner/NeedsFormatBanner used to live. */
export function ToastStack() {
  const { toasts, dismissToast } = useNotifications();
  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast" style={{ borderLeftColor: COLORS[toast.entry.color] }}>
          <div className="toast__dot" style={{ background: COLORS[toast.entry.color] }} />
          <div className="toast__text">{toast.entry.text}</div>
          <button type="button" className="toast__close" onClick={() => dismissToast(toast.id)} aria-label="Dismiss">
            &#10005;
          </button>
        </div>
      ))}
    </div>
  );
}
