import type {
  ContainerDetail,
  CreateContainerOptions,
  CreateContainerProgressCallback,
  DockerCommandResult,
  DockerContainerSummary,
} from './types.js';

export interface DockerClient {
  listContainers(): Promise<DockerContainerSummary[]>;
  inspectContainer(id: string): Promise<ContainerDetail>;
  startContainer(id: string): Promise<DockerCommandResult>;
  stopContainer(id: string): Promise<DockerCommandResult>;
  restartContainer(id: string): Promise<DockerCommandResult>;
  removeContainer(id: string, options?: { force?: boolean }): Promise<DockerCommandResult>;
  // The user-facing "permanently delete this" action (unlike removeContainer, which is also used
  // internally by the edit/recreate flow, where the image must stay cached for immediate reuse) —
  // force-removes the container, then best-effort removes the image it was created from too. Never
  // fails just because the image is still in use by another container; that case is reported in the
  // result message, not thrown.
  destroyContainer(id: string): Promise<DockerCommandResult>;
  createContainer(options: CreateContainerOptions, onProgress?: CreateContainerProgressCallback): Promise<DockerCommandResult>;
  getContainerLogs(id: string, tail?: number): Promise<string>;
  // The daemon's actual configured storage root (Docker Engine API's `DockerRootDir`) — the one
  // source of truth for "where does Docker actually keep its data", since this app doesn't manage
  // that path itself (see docker/storagePath.ts).
  getDataRoot(): Promise<string>;
  // Removes every image not referenced by any container (running or stopped) — not just dangling
  // (untagged) ones, since a plain "unused tagged image" like a leftover from a destroyed
  // container is the common case an admin actually wants cleaned up.
  pruneImages(): Promise<{ imagesDeleted: number; spaceReclaimedBytes: number }>;
}
