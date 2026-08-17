/**
 * Normalized shape - NOT a passthrough of the raw Docker Engine API (unlike
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
  ports: string; // e.g. "8096:8096" or "8096:8096, 8920:8920" or "-"
  portMappings: ContainerPortMapping[]; // structured form of the above, published ports only
  labels: Record<string, string>;
  // Resolved by routes/docker.ts (not DockerClient itself - the Docker layer
  // has no knowledge of CA templates), using the container's actual current
  // portMappings against its CA app's WebUI field, when it has one. Always
  // null coming out of a DockerClient implementation directly.
  webUiUrl: string | null;
  // Read straight off the container's icon label (see docker/realClient.ts for the exact key) -
  // a de facto convention CA templates (and many upstream images) use, so this works for any
  // container carrying it, not just ones installed through this app's own Apps feature.
  icon: string | null;
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
  // Maps to Docker's own RestartPolicy ("unless-stopped" vs "no") - Docker's native mechanism for
  // "start this container when the daemon starts", the same thing /array/start relies on to bring
  // containers back after a stopContainers-driven Docker restart (see routes/array.ts). Distinct
  // from "always", which would also restart a container the user explicitly stopped themselves -
  // "unless-stopped" respects that, matching what "start on boot" actually means to a user.
  autostart: boolean;
}

export interface CreateContainerProgress {
  phase: 'pulling' | 'removing' | 'creating' | 'starting';
  message: string;
  percent: number | null; // 0-100, or null when not (yet) knowable - e.g. image already cached, or a phase with no byte-level progress
  // A pull downloads/extracts each image layer independently and in parallel -
  // `layerId` ties this specific tick to one layer (Docker's own short layer
  // digest) so the client can render one persistent line per layer, the way
  // `docker pull` itself does, rather than a firehose of hundreds of ticks.
  // Absent outside the pulling phase, or for whole-pull events with no single
  // layer (e.g. the final "Digest: sha256:...").
  layerId?: string;
  layerStatus?: string;
}

export type CreateContainerProgressCallback = (progress: CreateContainerProgress) => void;

// Full detail for one container - used to populate an edit form from what's
// actually running, rather than DockerContainerSummary's list-view-only shape.
export interface ContainerEnvVar {
  name: string;
  value: string;
}

export interface ContainerPortMapping {
  containerPort: number;
  hostPort: number;
  protocol: 'tcp' | 'udp';
}

export interface ContainerVolumeMount {
  hostPath: string;
  containerPath: string;
  readOnly: boolean;
}

export interface ContainerDeviceMapping {
  hostPath: string;
  containerPath: string;
}

export interface ContainerDetail {
  id: string;
  name: string;
  image: string;
  network: string;
  privileged: boolean;
  env: ContainerEnvVar[];
  ports: ContainerPortMapping[];
  binds: ContainerVolumeMount[];
  devices: ContainerDeviceMapping[];
  labels: Record<string, string>;
  autostart: boolean;
}

// A manually-configured container (via the Docker tab's Add/Edit dialog) has
// no CA template behind it, so its request/plan shapes are the raw Docker
// fields directly rather than a Config-schema resolution like Apps' InstallPlan.
export interface ManualContainerRequest {
  containerName: string;
  image: string;
  network: string;
  privileged: boolean;
  env: ContainerEnvVar[];
  ports: ContainerPortMapping[];
  binds: ContainerVolumeMount[];
  devices: ContainerDeviceMapping[];
  privilegedAck?: boolean;
  autostart?: boolean;
}

export interface ManualPlanBind extends ContainerVolumeMount {
  allowed: boolean;
}

export interface ManualPlanDevice extends ContainerDeviceMapping {
  allowed: boolean;
}

export interface ManualContainerPlan {
  containerName: string;
  image: string;
  network: string;
  privileged: boolean;
  env: ContainerEnvVar[];
  ports: ContainerPortMapping[];
  binds: ManualPlanBind[];
  devices: ManualPlanDevice[];
  errors: string[];
  requiresPrivilegedAck: boolean;
  elevatedAccessReasons: string[];
  autostart: boolean;
}
