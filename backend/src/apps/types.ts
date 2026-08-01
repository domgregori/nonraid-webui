// Shapes transcribed from the Community Applications feed
// (https://assets.ca.unraid.net/feed/applicationFeed.json). `CaApp` only models
// the fields this project actually reads — the real feed has ~130 possible keys
// per entry, most app-specific and unused here.

export type CaConfigType = 'Port' | 'Variable' | 'Path' | 'Device' | 'Label';

export interface CaConfigAttributes {
  Name: string;
  Target: string;
  Default: string;
  Mode?: string; // absent on ~10% of real Path/Port entries — never assume present
  Description: string;
  Type: CaConfigType;
  Display: string; // 'always' | 'advanced' | 'always-hide' | ...
  Required: string; // 'true' | 'false'
  Mask: string; // 'true' | 'false'
}

export interface CaConfigEntry {
  '@attributes': CaConfigAttributes;
  value: string;
}

export interface CaApp {
  Name: string;
  Repository: string; // for a real Docker app, an image reference — but see `Plugin` below
  // A real Unraid *plugin* (a .plg/.txz package installed outside Docker
  // entirely, not a container) — appears in the same feed as Docker apps,
  // but its `Repository` is a .plg URL, not an image. There's no framework
  // in this project for installing plugins, so these must be filtered out
  // wherever the catalog is read, not just hidden in the UI — treating one
  // as a normal app would try to `docker pull` a .plg URL as an image.
  Plugin?: boolean;
  Registry?: string;
  Network?: string;
  Privileged?: string; // 'true' | 'false'
  Icon?: string;
  WebUI?: string; // template string, e.g. "http://[IP]:[PORT:3000]"
  TemplateURL?: string;
  Overview?: string;
  Category?: string;
  CategoryList?: string[];
  Config?: CaConfigEntry[];
  trending?: number; // recent trend score — higher means faster-growing right now
  LastUpdate?: number; // unix timestamp the template was last updated
  Date?: string; // date the template was first added to the feed, e.g. "2025-01-21" — sparse coverage
  FirstSeen?: number; // unix timestamp first seen in the feed — better coverage than Date
  downloads?: number; // Docker Hub pull count — note this is the image's total pulls, not installs of this app specifically
  stars?: number; // Docker Hub stars
  Support?: string; // support thread/link URL
  Project?: string; // project/source URL, usually GitHub
  Maintainer?: string;
  Author?: string;
  License?: string;
  [key: string]: unknown;
}

export interface CaFeed {
  apps: number;
  last_updated_timestamp: number;
  last_updated: string;
  categories: string[];
  applist: CaApp[];
  repositories?: unknown[];
  blacklisted?: unknown[];
  deprecated?: unknown[];
}

export interface InstalledInfo {
  containerId: string;
  containerName: string;
  state: 'running' | 'stopped';
  installedRepository: string; // image:tag actually running, captured as a label at install time
  // Only a tag-string comparison against the catalog's current Repository —
  // not a real registry/digest check — so this stays silent for ":latest"
  // style tags that haven't changed string but did get a new build upstream.
  updateAvailable: boolean;
}

// Slim projection served to the catalog grid — the full feed is too large to
// send to the frontend on every page load.
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

export interface AppListQuery {
  search?: string;
  category?: string;
  sort?: AppSort;
}

// User-editable overrides keyed by Config `Target`, resolved on top of the
// template's own defaults when a plan is built.
export type InstallOverrides = Record<string, string>;

export interface InstallRequest {
  name: string; // CaApp.Name — looked up in the cached feed, never trust a client-supplied template blob
  // Name alone isn't unique in the real feed (~150 names appear more than once,
  // often for genuinely different templates) — repository disambiguates which
  // entry was actually reviewed when more than one shares a name.
  repository?: string;
  containerName?: string;
  overrides?: InstallOverrides;
  privilegedAck?: boolean;
}

export interface PlanPortBinding {
  target: string;
  label: string; // short field name (Config's `Name` attribute) — description can be a full paragraph, unsuitable as a heading
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
  allowed: boolean; // false when hostPath falls outside the configured allowed roots
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
  errors: string[]; // hard problems (e.g. a bind outside the allowed roots) — install must be refused while non-empty
  requiresPrivilegedAck: boolean;
  // Human-readable reasons requiresPrivilegedAck is set — privileged, host
  // networking, and/or raw device passthrough are all equivalent-severity
  // host-access escalations, so they share one ack rather than separate ones.
  elevatedAccessReasons: string[];
}
