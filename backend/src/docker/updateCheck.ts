import type { DockerClient } from './client.js';

export interface ContainerUpdateStatus {
  containerId: string;
  /** null = not yet checked, or the last check attempt failed (see checkError) - "unknown", not
   *  "no", same convention as the nonraid update system's own ComponentUpdateStatus. */
  updateAvailable: boolean | null;
  /** The freshly-pulled image id from the last check, when it differed from what's running -
   *  null whenever updateAvailable isn't true. Exists mainly so DockerUpdateScheduler can key its
   *  once-per-new-state notification dedup on *which* update this is, not just "an update exists"
   *  - otherwise a second, newer image landing before the first one's ever applied would stay
   *  silent forever. */
  latestImageId: string | null;
  checkError: string | null;
  checkedAt: number | null;
}

function unknownStatus(containerId: string): ContainerUpdateStatus {
  return { containerId, updateAvailable: null, latestImageId: null, checkError: null, checkedAt: null };
}

// Simple in-memory cache, same reasoning as backend/src/update/service.ts's own cached-vs-live
// split: pulling every container's image on every dashboard load/poll would be a real registry
// round trip for no reason most of the time.
const cache = new Map<string, ContainerUpdateStatus>();

/** Pulls the container's own image reference fresh (DockerClient.pullImage - always hits the
 *  registry) and compares the resulting id against what the container is actually running
 *  (ContainerDetail.imageId). Updates the cache as a side effect so lastKnownStatus() reflects
 *  this immediately afterward. */
export async function checkContainerUpdate(docker: DockerClient, containerId: string): Promise<ContainerUpdateStatus> {
  let status: ContainerUpdateStatus;
  try {
    const detail = await docker.inspectContainer(containerId);
    const pulled = await docker.pullImage(detail.image);
    const updateAvailable = pulled.id !== detail.imageId;
    status = { containerId, updateAvailable, latestImageId: updateAvailable ? pulled.id : null, checkError: null, checkedAt: Date.now() };
  } catch (err) {
    status = { containerId, updateAvailable: null, latestImageId: null, checkError: (err as Error).message, checkedAt: Date.now() };
  }
  cache.set(containerId, status);
  return status;
}

/** Whatever the last check found for this container, without triggering a live one - the
 *  all-null/unknown shape before it's ever been checked rather than undefined, so callers don't
 *  need a separate "no data yet" case. */
export function lastKnownStatus(containerId: string): ContainerUpdateStatus {
  return cache.get(containerId) ?? unknownStatus(containerId);
}

/** Checks every current container (Community-Apps-installed or custom alike - the mechanism only
 *  needs an image reference) best-effort - one failing doesn't block the rest. Used by both
 *  DockerUpdateScheduler's periodic tick and a manual "check all" action. */
export async function checkAllContainers(docker: DockerClient): Promise<ContainerUpdateStatus[]> {
  const containers = await docker.listContainers();
  return Promise.all(containers.map((c) => checkContainerUpdate(docker, c.id)));
}
