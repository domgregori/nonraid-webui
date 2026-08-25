import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { BUILD_TAG } from '../buildInfo.generated.js';

const execFileAsync = promisify(execFile);

// Versioning convention for both repos, decided explicitly (not the "track main's tip" scheme
// this originally shipped with): a manually-pushed, semver git tag (v0.1.0, v0.2.0, ...) marks a
// real release. Nothing else counts - not PACKAGE_VERSION (doesn't reliably bump on every fix,
// see tools/install-webui.sh's build_nonraid_driver comment), not a bare commit hash. Neither repo
// has ever pushed one of these tags as of this writing - see readInstalledDriverTag()/BUILD_TAG's
// own comments for what "no tags yet" means for each side of this comparison.
const NONRAID_REPO_URL = 'https://github.com/domgregori/nonraid.git';
const NONRAID_WEBUI_REPO_URL = 'https://github.com/domgregori/nonraid-webui.git';

const SEMVER_TAG_RE = /^v\d+\.\d+\.\d+$/;

// Written by tools/install-webui.sh's build_nonraid_driver(), only after a `dkms install` actually
// succeeds against a checkout that was itself exactly at a tag (fetch_nonraid_source() refuses to
// build from anything else - see its own comment) - so this file existing at all means "installed
// from a real release," never a mid-build or untagged-commit false positive.
const NONRAID_DRIVER_VERSION_FILE = '/etc/nonraid/driver-version';

// git ls-remote against GitHub is a network call - bounded so a flaky/offline connection reports
// as a clear per-component checkError rather than hanging the whole status response.
const LS_REMOTE_TIMEOUT_MS = 10_000;

export interface ComponentUpdateStatus {
  /** The release tag this component was actually built/installed from (e.g. "v0.2.0"), or null
   *  when it wasn't built from a tagged release at all - true for every install today, since
   *  neither repo has pushed a first tag yet, and also true for an ordinary dev checkout that's
   *  ahead of (or just never at) any tag. */
  installed: string | null;
  /** The newest semver tag currently pushed to the repo, or null when there are no tags at all
   *  (true for both repos today) or the last check attempt failed (see checkError) - either way,
   *  null here means "nothing to update to," not an error on its own. */
  latest: string | null;
  /** null (not false) when installed or latest couldn't be determined - "unknown", not "no". */
  upToDate: boolean | null;
  checkError: string | null;
}

export interface UpdateStatus {
  nonraid: ComponentUpdateStatus;
  nonraidWebui: ComponentUpdateStatus;
  /** epoch ms of the last live check (cache population), or null if one has never run. */
  checkedAt: number | null;
}

async function readInstalledDriverTag(): Promise<string | null> {
  try {
    return (await readFile(NONRAID_DRIVER_VERSION_FILE, 'utf8')).trim() || null;
  } catch {
    return null;
  }
}

/** The newest semver-looking tag currently pushed to repoUrl, or null when it has none - no
 *  clone, just a ref listing. Throws with a short, user-facing-safe message on a real failure
 *  (offline, DNS, GitHub down, git missing) - "no tags exist" is a normal return, not a throw. */
async function latestTag(repoUrl: string): Promise<string | null> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('git', ['ls-remote', '--tags', '--sort=-v:refname', repoUrl], {
      timeout: LS_REMOTE_TIMEOUT_MS,
    }));
  } catch (err) {
    throw new Error(`could not reach ${repoUrl}: ${(err as Error).message}`);
  }
  // Each annotated tag lists twice (the tag object itself, and a "^{}" line peeled to the commit
  // it points at) - lightweight tags list once. Drop the peeled duplicates; --sort already put
  // real releases in descending version order, so the first survivor is the latest one.
  const tags = stdout
    .split('\n')
    .map((line) => line.split('\t')[1])
    .filter((ref): ref is string => !!ref && !ref.endsWith('^{}'))
    .map((ref) => ref.replace(/^refs\/tags\//, ''))
    .filter((tag) => SEMVER_TAG_RE.test(tag));
  return tags[0] ?? null;
}

async function checkComponent(installed: string | null, repoUrl: string): Promise<ComponentUpdateStatus> {
  try {
    const latest = await latestTag(repoUrl);
    // Exact match, not a prefix/fuzzy comparison - both sides are real tag names now, not commit
    // hashes, so "the same tag" is the only thing "up to date" can mean. null on either side means
    // "can't tell" (no release installed from / no release published yet), not "no".
    const upToDate = installed && latest ? installed === latest : null;
    return { installed, latest, upToDate, checkError: null };
  } catch (err) {
    return { installed, latest: null, upToDate: null, checkError: (err as Error).message };
  }
}

// Simple in-memory cache: checking GitHub on every dashboard load/poll would be a live network
// round trip for no reason most of the time. `checkForUpdates(false)` (the status-route default)
// serves the cached result and never blocks on the network; only an explicit "Check for updates
// now" (force=true) or an empty cache does a live check.
let cached: UpdateStatus | null = null;

export async function checkForUpdates(force: boolean): Promise<UpdateStatus> {
  if (cached && !force) return cached;

  const [nonraid, nonraidWebui] = await Promise.all([
    checkComponent(await readInstalledDriverTag(), NONRAID_REPO_URL),
    checkComponent(BUILD_TAG, NONRAID_WEBUI_REPO_URL),
  ]);

  cached = { nonraid, nonraidWebui, checkedAt: Date.now() };
  return cached;
}

/** Last-known status without triggering a check at all (for a route that just wants "whatever we
 *  last saw", e.g. a dashboard badge) - returns a fully-null/unknown shape before the first check
 *  has ever run rather than null itself, so callers don't need a separate "no data yet" case. */
export function lastKnownUpdateStatus(): UpdateStatus {
  return (
    cached ?? {
      nonraid: { installed: null, latest: null, upToDate: null, checkError: null },
      nonraidWebui: { installed: null, latest: null, upToDate: null, checkError: null },
      checkedAt: null,
    }
  );
}
