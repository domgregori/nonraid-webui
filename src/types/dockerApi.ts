// Mirrors backend/src/docker/types.ts (DockerContainerSummary). Keep in sync.
export type ContainerRuntimeStatus = 'running' | 'stopped';

export interface DockerContainerSummary {
  id: string;
  name: string;
  image: string;
  state: ContainerRuntimeStatus;
  status: string;
  cpuPercent: number | null;
  memUsedBytes: number | null;
  memLimitBytes: number | null;
  ports: string;
}

export interface DockerCommandResult {
  ok: boolean;
  message: string;
}
