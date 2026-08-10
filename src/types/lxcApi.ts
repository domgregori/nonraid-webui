// Mirrors backend/src/lxc/types.ts. Keep in sync.
export type LxcRuntimeState = 'running' | 'stopped' | 'frozen' | 'unknown';

export interface LxcContainerSummary {
  name: string;
  state: LxcRuntimeState;
  autostart: boolean;
  description: string | null;
  webUiUrl: string | null;
  cpuPercent: number | null;
  memUsedBytes: number | null;
  memLimitBytes: number | null;
  ips: string[];
}

export interface LxcCommandResult {
  ok: boolean;
  message: string;
}

export interface LxcContainerDetail {
  name: string;
  state: LxcRuntimeState;
  autostart: boolean;
  description: string | null;
  webUiUrl: string | null;
  pid: number | null;
  rootfsPath: string | null;
  bridge: string | null;
  macAddress: string | null;
  cpuLimit: string | null;
  memLimitBytes: number | null;
}

export interface CreateLxcContainerRequest {
  name: string;
  distribution: string;
  release: string;
  arch: string;
  bridge: string;
  autostart: boolean;
  description: string;
  webUiUrl: string;
}

export interface CreateLxcProgress {
  phase: 'creating' | 'configuring' | 'starting';
  message: string;
  percent: null;
}

export interface LxcDistroOption {
  distribution: string;
  release: string;
  label: string;
}

export interface LxcDistrosResponse {
  distros: LxcDistroOption[];
  defaultArch: string;
}

export interface PruneTemplateCacheResult {
  spaceReclaimedBytes: number;
}
