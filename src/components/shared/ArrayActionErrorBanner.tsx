/** Shared array-action error banner - Dashboard and Disks pages both let the user start/stop the
 *  array (and Disks also unassigns/restores disks), and both need the same plain-error display.
 *
 *  onRetryWithStopContainers is optional: Dashboard/Disks omit it and rely on the global
 *  ArrayStopBlockedModal instead for the "Docker/LXC is holding a disk open" retry prompt, since
 *  the header's Stop Array button is reachable from every page and that confirmation can't depend
 *  on being mounted only on these two. ShrinkArrayDialog still passes it and renders the retry
 *  button inline here - it's already its own confirm modal (a separate flow, shrinkArray rather
 *  than stopArray, with fully local state), so it doesn't have that page-dependency problem. */
interface ArrayActionErrorBannerProps {
  actionError: string;
  stopBlockedByContainers: boolean;
  arrayPending?: boolean;
  onRetryWithStopContainers?: () => void;
}

export function ArrayActionErrorBanner({ actionError, stopBlockedByContainers, arrayPending, onRetryWithStopContainers }: ArrayActionErrorBannerProps) {
  if (stopBlockedByContainers && !onRetryWithStopContainers) return null;
  return (
    <div className="status-note status-note--error">
      {stopBlockedByContainers ? 'A disk is in use by Docker or LXC. Stop containers?' : actionError}
      {stopBlockedByContainers && onRetryWithStopContainers && (
        <div style={{ marginTop: 8 }}>
          <button type="button" className="btn btn--danger" disabled={arrayPending} onClick={onRetryWithStopContainers}>
            {arrayPending ? 'Stopping…' : 'Stop Docker/LXC and retry'}
          </button>
        </div>
      )}
    </div>
  );
}
