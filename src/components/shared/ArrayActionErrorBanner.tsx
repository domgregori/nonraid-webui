/** Shared array-stop error banner - Dashboard and Disks pages both let the user stop the array,
 *  and both need the same "Docker/LXC is holding a disk open" retry offer (see /array/stop's
 *  stopContainers opt-in in routes/array.ts). Kept as one component after the retry button was
 *  added to Dashboard but missed on Disks, so the two can't drift apart again. */
interface ArrayActionErrorBannerProps {
  actionError: string;
  stopBlockedByContainers: boolean;
  arrayPending: boolean;
  onRetryWithStopContainers: () => void;
}

export function ArrayActionErrorBanner({ actionError, stopBlockedByContainers, arrayPending, onRetryWithStopContainers }: ArrayActionErrorBannerProps) {
  return (
    <div className="status-note status-note--error">
      {stopBlockedByContainers ? 'A disk is in use by Docker or LXC. Stop containers?' : actionError}
      {stopBlockedByContainers && (
        <div style={{ marginTop: 8 }}>
          <button type="button" className="btn btn--danger" disabled={arrayPending} onClick={onRetryWithStopContainers}>
            {arrayPending ? 'Stopping…' : 'Stop Docker/LXC and retry'}
          </button>
        </div>
      )}
    </div>
  );
}
