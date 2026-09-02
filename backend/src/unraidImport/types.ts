import type { AllocationMethod } from '../shares/types.js';

/**
 * Whether a path (from an archive entry or a folder-picker file) is one this importer actually
 * reads - share.cfg, shares/*.cfg, or passwd, at any depth (the config/ root isn't known until
 * findConfigRoot() runs, so this matches by suffix rather than an exact prefix). Everything else in
 * a real Unraid config/ directory - and there's a lot of it, every installed plugin's own package
 * files (.txz) live under config/plugins/, including every historical version ever cached, not
 * just the current one - is dead weight for this feature specifically. Confirmed live: a real
 * user's config/ directory came to 311MB, almost entirely plugin packages having nothing to do
 * with shares or users. Used twice: server-side to skip decompressing/buffering irrelevant archive
 * entries (archive.ts), and mirrored client-side to filter a folder-picker selection before
 * anything is even read off disk, let alone uploaded (ImportUnraidWizard.tsx) - archive-mode still
 * has to receive the whole uploaded blob regardless, since there's no cheap way to filter inside an
 * already-built archive before it's fully uploaded.
 */
export function isRelevantConfigPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized === 'share.cfg' || normalized.endsWith('/share.cfg')) return true;
  if (normalized === 'passwd' || normalized.endsWith('/passwd')) return true;
  if (/(^|\/)shares\/[^/]+\.cfg$/.test(normalized)) return true;
  // docker.cfg/domain.cfg declare which shares (if any) hold Docker's own engine storage and a
  // VM's vdisks/install media - see parser.ts's detectSpecialShares() doc comment for why this
  // importer reads them at all.
  if (normalized === 'docker.cfg' || normalized.endsWith('/docker.cfg')) return true;
  if (normalized === 'domain.cfg' || normalized.endsWith('/domain.cfg')) return true;
  // Community-Applications-installed container templates - one XML file per installed container,
  // written by dockerMan itself (not CA), so every one of them describes a container that was
  // actually running, not just something once browsed in the CA catalog. See dockerTemplateParser.ts.
  return /(^|\/)plugins\/dockerMan\/templates-user\/[^/]+\.xml$/.test(normalized);
}

/** One file pulled out of an uploaded archive or folder, path relative to whatever directory
 *  turned out to actually be Unraid's `config/` (see findConfigRoot() in parser.ts - the upload
 *  can be rooted at the flash drive itself, at `config/` directly, or anywhere in between). */
export interface ImportedFile {
  relativePath: string;
  content: Buffer;
}

/** A share as parsed from `config/shares/<name>.cfg`, already mapped onto this app's own
 *  AllocationMethod - never applied automatically, only ever shown for the admin to confirm. */
export interface ParsedShare {
  name: string;
  allocationMethod: AllocationMethod;
  floorGb: number;
  comment: string;
  // Usernames from shareReadList/shareWriteList - carried through so a later-created user (see
  // PendingImportUser) knows which shares to get access to, but never applied at share-creation
  // time itself (the user may not exist yet, or ever - see the wizard's own doc comment).
  readUsers: string[];
  writeUsers: string[];
  // True when shareInclude/shareExclude named specific disks this parser couldn't confidently map
  // to a slot number - the share still gets a row in the preview (defaulting to all disks), just
  // flagged so the admin knows to double check disk placement themselves after import.
  diskRestrictionUnmapped: boolean;
  // Non-null when docker.cfg/domain.cfg names this share as holding Unraid's own Docker/VM engine
  // storage rather than real data (see parser.ts's detectSpecialShares()) - the share still gets a
  // row in the preview, just left unchecked by default with this as the explanation, since nothing
  // stops an admin from genuinely wanting it if they repurposed the share for something else.
  specialReason: string | null;
}

/** A real (non-system) account from `config/passwd` - filtered to UID >= 1000, the standard
 *  convention this app's own realClient.ts and every real Unraid install both already follow for
 *  "an actual user account" vs. a service/system account (root, sshd, nobody, ...). */
export interface ParsedUser {
  username: string;
  uid: number;
}

export interface UnraidImportWarning {
  message: string;
}

/** One Community-Applications-installed container, as parsed from its dockerMan template XML
 *  (config/plugins/dockerMan/templates-user/*.xml) - already a completed, install-time-resolved
 *  config (ports/paths/variables all have real values baked in, not a CA Config *schema* still
 *  needing input), so this maps directly onto this app's own manual-container-creation shape
 *  (see routes/unraidImport.ts's toManualContainerRequest()) rather than going through Apps'
 *  CA-catalog install flow - nothing here depends on this app's own catalog listing the same app. */
export interface ParsedDockerContainer {
  name: string;
  image: string;
  network: string;
  privileged: boolean;
  // Display-only in the review step - this app has no per-manual-container WebUI persistence (see
  // routes/docker.ts's withWebUiUrl doc comment), so this is never sent to the create-container call.
  webUiUrl: string | null;
  ports: { containerPort: number; hostPort: number; protocol: 'tcp' | 'udp' }[];
  binds: { hostPath: string; containerPath: string; readOnly: boolean }[];
  env: { name: string; value: string }[];
  devices: { hostPath: string; containerPath: string }[];
  // Template fields this parser found but has nothing to map onto (ExtraParams, CPUset, ...) -
  // surfaced as a warning rather than silently dropped, so an admin who relies on one of them knows
  // to set it up by hand after import instead of assuming it carried over.
  unsupportedFields: string[];
}

export interface UnraidImportPreview {
  token: string;
  shares: ParsedShare[];
  users: ParsedUser[];
  dockerContainers: ParsedDockerContainer[];
  warnings: UnraidImportWarning[];
}
