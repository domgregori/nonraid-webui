// Mirrors backend/src/apps/types.ts. Keep in sync.

export type CaConfigType = 'Port' | 'Variable' | 'Path' | 'Device' | 'Label';

export interface CaConfigAttributes {
  Name: string;
  Target: string;
  Default: string;
  Mode: string;
  Description: string;
  Type: CaConfigType;
  Display: string;
  Required: string;
  Mask: string;
}

export interface CaConfigEntry {
  '@attributes': CaConfigAttributes;
  value: string;
}

export interface CaApp {
  Name: string;
  Repository: string;
  Registry?: string;
  Network?: string;
  Privileged?: string;
  Icon?: string;
  WebUI?: string;
  TemplateURL?: string;
  Overview?: string;
  Category?: string;
  CategoryList?: string[];
  Config?: CaConfigEntry[];
  trending?: number;
  LastUpdate?: number;
  Date?: string;
  FirstSeen?: number;
  downloads?: number;
  stars?: number;
  Support?: string;
  Project?: string;
  Maintainer?: string;
  Author?: string;
  License?: string;
  [key: string]: unknown;
}

export interface InstalledInfo {
  containerId: string;
  containerName: string;
  state: 'running' | 'stopped';
  installedRepository: string;
  updateAvailable: boolean;
}

export interface AppSummary {
  name: string;
  repository: string;
  icon: string | null;
  overviewShort: string | null;
  categories: string[];
  privileged: boolean;
  installed: InstalledInfo | null;
}

export type AppSort = 'trending' | 'latest' | 'new';

export interface FeedMeta {
  appCount: number;
  lastUpdated: string;
  fetchedAt: number;
}

export type InstallOverrides = Record<string, string>;

export interface InstallRequest {
  repository?: string;
  containerName?: string;
  overrides?: InstallOverrides;
  privilegedAck?: boolean;
}

export interface PlanPortBinding {
  target: string;
  label: string;
  description: string;
  required: boolean;
  containerPort: number;
  hostPort: number;
  protocol: 'tcp' | 'udp';
}

export interface PlanEnvVar {
  target: string;
  label: string;
  description: string;
  required: boolean;
  name: string;
  value: string;
  masked: boolean;
}

export interface PlanBind {
  target: string;
  label: string;
  description: string;
  required: boolean;
  containerPath: string;
  hostPath: string;
  readOnly: boolean;
  allowed: boolean;
}

export interface PlanDevice {
  target: string;
  label: string;
  description: string;
  required: boolean;
  containerPath: string;
  hostPath: string;
  allowed: boolean;
}

export interface InstallPlan {
  appName: string;
  containerName: string;
  image: string;
  network: string;
  privileged: boolean;
  webUi: string | null;
  ports: PlanPortBinding[];
  env: PlanEnvVar[];
  binds: PlanBind[];
  devices: PlanDevice[];
  errors: string[];
  requiresPrivilegedAck: boolean;
  elevatedAccessReasons: string[];
}

export interface DockerCommandResult {
  ok: boolean;
  message: string;
}
