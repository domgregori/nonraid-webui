import type { AllocationMethod } from './sharesApi';

export interface ParsedShare {
  name: string;
  allocationMethod: AllocationMethod;
  floorGb: number;
  comment: string;
  readUsers: string[];
  writeUsers: string[];
  diskRestrictionUnmapped: boolean;
  // Non-null when Unraid's own docker.cfg/domain.cfg names this share as holding Docker/VM engine
  // storage rather than real data - see backend parser.ts's detectSpecialShares(). Still shown in
  // the review step, just left unchecked by default with this as the explanation.
  specialReason: string | null;
}

export interface ParsedUser {
  username: string;
  uid: number;
}

export interface UnraidImportWarning {
  message: string;
}

/** Mirrors backend/src/unraidImport/types.ts's ParsedDockerContainer. */
export interface ParsedDockerContainer {
  name: string;
  image: string;
  network: string;
  privileged: boolean;
  webUiUrl: string | null;
  ports: { containerPort: number; hostPort: number; protocol: 'tcp' | 'udp' }[];
  binds: { hostPath: string; containerPath: string; readOnly: boolean }[];
  env: { name: string; value: string }[];
  devices: { hostPath: string; containerPath: string }[];
  unsupportedFields: string[];
}

export interface UnraidImportPreview {
  token: string;
  shares: ParsedShare[];
  users: ParsedUser[];
  dockerContainers: ParsedDockerContainer[];
  warnings: UnraidImportWarning[];
}

export interface UnraidImportCommitResult {
  created: string[];
  failed: { name: string; error: string }[];
  usersQueued: number;
}

export interface DockerImportCommitResult {
  created: string[];
  // Names that already existed as a Docker container (from an earlier import, or created some
  // other way) - left untouched rather than attempted and reported as a failure.
  skipped: string[];
  failed: { name: string; error: string }[];
}

/** One tick of the commit-shares ndjson stream - fires right before the named share's own create
 *  work starts (see backend ShareService.createMany()'s onProgress doc comment). */
export interface ShareImportProgress {
  name: string;
  index: number;
  total: number;
}

/** One tick of the commit-docker-containers ndjson stream - {name, index, total} alone is the
 *  coarse per-container tick (mirrors ShareImportProgress, fires right before work on that
 *  container starts); the rest is Docker's own real pull/create/start progress for whichever
 *  container is currently active, forwarded on top of it (see routes/unraidImport.ts) so a slow
 *  image pull shows real status instead of the wizard looking stalled for as long as it takes. */
export interface DockerImportProgress {
  name: string;
  index: number;
  total: number;
  phase?: 'pulling' | 'removing' | 'creating' | 'starting';
  message?: string;
  percent?: number | null;
  layerId?: string;
  layerStatus?: string;
}

export interface PendingImportUser {
  username: string;
  readShares: string[];
  writeShares: string[];
}

/**
 * Mirrors backend/src/unraidImport/types.ts's isRelevantConfigPath() exactly - no shared package
 * between frontend and backend in this repo, so this is duplicated rather than imported. Used by
 * ImportUnraidWizard's folder picker to filter file selection *before* anything is even read off
 * disk, let alone uploaded - a real Unraid config/ directory's plugin package cache alone can run
 * into the hundreds of MB (confirmed live), none of it anything this importer reads.
 */
export function isRelevantConfigPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized === 'share.cfg' || normalized.endsWith('/share.cfg')) return true;
  if (normalized === 'passwd' || normalized.endsWith('/passwd')) return true;
  if (/(^|\/)shares\/[^/]+\.cfg$/.test(normalized)) return true;
  if (normalized === 'docker.cfg' || normalized.endsWith('/docker.cfg')) return true;
  if (normalized === 'domain.cfg' || normalized.endsWith('/domain.cfg')) return true;
  return /(^|\/)plugins\/dockerMan\/templates-user\/[^/]+\.xml$/.test(normalized);
}
