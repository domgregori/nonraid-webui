// Minimal mirrors of the backend response shapes this CLI's curated command set actually reads -
// see backend/API.md for the full API and backend/src/nmd/types.ts, backend/src/docker/types.ts,
// backend/src/lxc/types.ts for the authoritative definitions. Deliberately not imported directly
// from backend/src: cli/ is an independent package (its own tsconfig/rootDir), matching how
// backend/ is already independent of the root frontend package - see the handoff's "Decisions
// already made" #4.

export interface NmdArrayStatus {
  label: string;
  state: string;
  disks_present: number;
  disks_imported: number;
  disks_unassigned: number;
  total_slots: number;
  health: { missing: number; disabled: number; replaced: number; new: number; sync_errors: number; disk_errors: number };
}

export interface NmdResyncStatus {
  active: boolean;
  paused: boolean;
  pending: boolean;
  action: string;
  progress_percent: number;
  rate_mb_s: number;
  eta_seconds: number;
}

export interface NmdDisk {
  slot: number;
  type: string;
  size_gb: number;
  device: string;
  status: string;
  disk_name: string;
}

export interface NmdStatusResponse {
  array: NmdArrayStatus;
  resync: NmdResyncStatus;
  disks: NmdDisk[];
}

// Shared shape for nmdctl/Docker/LXC action results alike (start/stop/spin-up/spin-down/...) - all
// three backend clients return exactly this, see backend/src/nmd/types.ts's NmdCommandResult,
// backend/src/docker/types.ts's DockerCommandResult, backend/src/lxc/types.ts's LxcCommandResult.
export interface CommandResult {
  ok: boolean;
  message: string;
}

export interface DockerContainerSummary {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  cpuPercent: number | null;
  memUsedBytes: number | null;
}

export interface LxcContainerSummary {
  name: string;
  state: string;
  autostart: boolean;
  cpuPercent: number | null;
  memUsedBytes: number | null;
  ips: string[];
}

// -- Shares (Pools) - see backend/src/shares/types.ts --

export type AllocationMethod = 'most-free' | 'fill-up' | 'high-water' | 'single-disk' | 'cache-only';
export type ShareProtocol = 'smb' | 'nfs';
export type SharePermission = 'read-write' | 'read-only' | 'none' | 'hidden';

export interface ShareAccess {
  users: Record<string, SharePermission>;
  groups: Record<string, SharePermission>;
}

export interface ShareInput {
  name: string;
  disks: number[];
  allDisks?: boolean;
  allocationMethod: AllocationMethod;
  protocols: ShareProtocol[];
  smb?: { public: boolean };
  nfs?: { allowedHosts: string[]; readOnly: boolean };
  description?: string;
}

export interface ShareWithStats extends ShareInput {
  stats: { usedBytes: number | null; totalBytes: number | null };
  activeConnections: number;
  access: ShareAccess;
}

// -- Users & Groups - see backend/src/users/types.ts, backend/src/users/service.ts --

export interface NrUser {
  username: string;
  uid: number;
  groups: string[];
}

export interface NrGroup {
  name: string;
  gid: number;
}

export interface ShareAccessEntry {
  shareName: string;
  permission: SharePermission;
}

// -- System - see backend/src/system/types.ts, backend/src/system/bootSnapshots.ts --

export interface SystemStats {
  hostname: string;
  timezone: string;
  uptimeSeconds: number;
  cpuPercent: number;
  cpuTempCelsius: number | null;
  memUsedBytes: number;
  memTotalBytes: number;
  buildVersion: string | null;
  version: string;
  bootDisk: { device: string; filesystem: string | null; usedBytes: number | null; totalBytes: number | null; model: string | null; tempCelsius: number | null; uuid: string | null } | null;
  networkInterfaces: { name: string; ipv4: string[]; ipv6: string[]; mac: string | null }[];
}

export interface RestartServicesResult {
  smb: { ok: boolean; message: string };
  nfs: { ok: boolean; message: string };
  driverReload: { ok: boolean; message: string };
  rcloneRcd: { ok: boolean; message: string };
  docker: { ok: boolean; message: string } | null;
  message: string;
}

export interface BootSnapshot {
  name: string;
  kind: 'pre-update' | 'manual';
  label: string | null;
  createdAtLocal: string;
  inGrubMenu: boolean;
  size: { totalBytes: number; exclusiveBytes: number } | null;
}

export interface BootSnapshotsResponse {
  btrfsRoot: boolean;
  snapshots: BootSnapshot[];
}

// -- Services - see backend/src/system/services.ts, backend/src/routes/services.ts --

export type ServiceState = 'active' | 'inactive' | 'failed' | 'mixed';

export interface ServiceRow {
  id: string;
  label: string;
  state: ServiceState;
}

// -- SMART - see backend/src/smart/types.ts --

export type SmartHealth = 'passed' | 'failed';
export type SmartSpinState = 'active' | 'standby' | 'unknown';
export type SelfTestType = 'short' | 'long' | 'conveyance';

export interface SmartAttributes {
  device: string;
  model: string | null;
  serial: string | null;
  wwn: string | null;
  capacityBytes: number | null;
  health: SmartHealth | null;
  temperature: number | null;
  rotationRpm: number | null;
  spinState: SmartSpinState;
  powerOnHours: number | null;
  powerCycleCount: number | null;
  reallocatedSectors: number | null;
  pendingSectors: number | null;
  uncorrectableSectors: number | null;
  selfTest: { state: string; type: SelfTestType | null; progressPct: number | null; statusText: string | null };
}

// -- Cache - see backend/src/cache/types.ts --

export type CacheHealth = 'not-configured' | 'healthy' | 'degraded' | 'unavailable';

export interface CacheDeviceStatus {
  devid: number;
  path: string | null;
  model: string | null;
  smartHealth: SmartHealth | null;
  missing: boolean;
}

export interface CacheStatus {
  health: CacheHealth;
  enabled: boolean;
  fsUuid: string | null;
  devices: CacheDeviceStatus[];
  usedBytes: number | null;
  totalBytes: number | null;
}

export interface CacheReplaceStatus {
  running: boolean;
  progressPercent: number | null;
  message: string | null;
}

export interface CacheMoverStatus {
  running: boolean;
  [key: string]: unknown;
}

// -- Activity, Logs, Metrics - see backend/src/activity/types.ts, backend/src/system/logs.ts,
// backend/src/metrics/types.ts --

export interface ActivityEntry {
  id: string;
  timestamp: number;
  text: string;
  color: 'blue' | 'green' | 'amber' | 'red';
}

export interface LogSourceRow {
  id: string;
  label: string;
}

export interface LogQueryResult {
  logs: string;
  nextSince: number | null;
}

export interface MetricPoint {
  ts: number;
  value: number;
}

export interface MetricSeries {
  metric: string;
  key: string;
  points: MetricPoint[];
}

// -- Rclone (Remote Backup) - see backend/src/rclone/types.ts --

export interface RcloneDaemonStatus {
  installed: boolean;
  running: boolean;
  featureEnabled: boolean;
}

export interface RcloneRemote {
  name: string;
  type: string;
  status: 'ok' | 'authExpired' | 'error' | 'unknown';
  statusMessage: string | null;
}

export type SyncScope = 'config' | 'configAppdata' | 'custom';

export interface SyncJobRetention {
  keepDays: number;
  forever: boolean;
}

export interface RecurringSchedule {
  enabled: boolean;
  [key: string]: unknown;
}

export interface SyncJobWithRuntime {
  id: string;
  name: string;
  enabled: boolean;
  scope: SyncScope;
  customPath: string;
  remoteName: string;
  remotePath: string;
  schedule: RecurringSchedule;
  retention: SyncJobRetention;
  encryption: { enabled: boolean; hasPassword: boolean };
  lastSyncedAt: number | null;
  lastSizeBytes: number | null;
  lastFileCount: number | null;
  lastErrorCount: number | null;
  lastError: string | null;
  state: 'idle' | 'syncing' | 'disabled';
  progress: {
    bytes: number;
    totalBytes: number;
    speedBytesPerSec: number;
    etaSeconds: number | null;
    filesDone: number;
    filesTotal: number;
    transferringName: string | null;
  } | null;
}

export interface RemoteBackupEntry {
  name: string;
  sizeBytes: number;
  modTime: string;
  encrypted: boolean;
  categories: string[] | null;
}
