/**
 * Normalized shape — NOT a passthrough of the raw Docker Engine API (unlike
 * nmd/types.ts, which mirrors nmdctl's JSON verbatim). The raw container
 * inspect/stats payloads are large and stats require a derived CPU% calc,
 * so both DockerClient implementations produce this shape directly.
 */
export type ContainerRuntimeState = 'running' | 'stopped';

export interface DockerContainerSummary {
  id: string;
  name: string;
  image: string;
  state: ContainerRuntimeState;
  status: string; // human string from Docker, e.g. "Up 2 hours" / "Exited (0) 3 days ago"
  cpuPercent: number | null; // null when stopped (no stats available)
  memUsedBytes: number | null;
  memLimitBytes: number | null;
  ports: string; // e.g. "8096:8096" or "8096:8096, 8920:8920" or "—"
  labels: Record<string, string>;
}

export interface DockerCommandResult {
  ok: boolean;
  message: string;
}

export interface CreateContainerPortBinding {
  containerPort: number;
  protocol: 'tcp' | 'udp';
  hostPort: number;
}

export interface CreateContainerDevice {
  hostPath: string;
  containerPath: string;
}

export interface CreateContainerOptions {
  name: string;
  image: string;
  network: string; // 'bridge' | 'host' | 'none' | a custom network name
  privileged: boolean;
  env: string[]; // "KEY=VALUE"
  ports: CreateContainerPortBinding[];
  binds: string[]; // "hostPath:containerPath" or "hostPath:containerPath:ro"
  devices: CreateContainerDevice[];
  labels: Record<string, string>;
}

export interface CreateContainerProgress {
  phase: 'pulling' | 'creating' | 'starting';
  message: string;
  percent: number | null; // 0-100, or null when not (yet) knowable — e.g. image already cached, or a phase with no byte-level progress
}

export type CreateContainerProgressCallback = (progress: CreateContainerProgress) => void;
