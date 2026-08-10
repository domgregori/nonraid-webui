// Mirrors backend/src/docker/types.ts. Keep in sync.
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
  portMappings: ContainerPortMapping[];
  labels: Record<string, string>;
  // Resolved server-side from the CA app's WebUI field against this
  // container's actual ports, when it's a CA-installed container with one.
  // [IP] is left unresolved for us to fill in — see resolveContainerWebUi.
  // Null for custom containers, or CA ones with no WebUI/unresolvable app.
  webUiUrl: string | null;
  icon: string | null;
}

export interface DockerCommandResult {
  ok: boolean;
  message: string;
}

export interface PruneImagesResult {
  imagesDeleted: number;
  spaceReclaimedBytes: number;
}

export interface CreateContainerProgress {
  phase: 'pulling' | 'removing' | 'creating' | 'starting';
  message: string;
  percent: number | null;
  layerId?: string;
  layerStatus?: string;
}

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
}

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
}

// Labels stamped by the Apps (Community Applications) feature at install
// time — mirrors backend/src/apps/service.ts's APP_NAME_LABEL/
// APP_REPOSITORY_LABEL. A container carrying these came from installing a
// CA template rather than the Docker tab's manual Add Container flow.
export const CA_APP_NAME_LABEL = 'com.nonraid.apps.name';
export const CA_APP_REPOSITORY_LABEL = 'com.nonraid.apps.repository';
