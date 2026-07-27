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
}

export interface DockerCommandResult {
  ok: boolean;
  message: string;
}
