import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { BUILD_TAG } from '../buildInfo.generated.js';

const execFileAsync = promisify(execFile);

// Versioning convention for both repos, decided explicitly (not the "track main's tip" scheme
// this originally shipped with): a manually-pushed, semver git tag (v0.1.0, v0.2.0, ...) marks a
// real release. Nothing else counts - not PACKAGE_VERSION (doesn't reliably bump on every fix,
// see tools/install-webui.sh's build_nonraid_driver comment), not a bare commit hash.
const NONRAID_REPO_URL = 'https://github.com/domgregori/nonraid.git';
const NONRAID_WEBUI_REPO_URL = 'https://github.com/domgregori/nonraid-webui.git';

const SEMVER_TAG_RE = /^v\d+\.\d+\.\d+$/;

// Written by tools/install-webui.sh's build_nonraid_driver(), only after a `dkms install` actually
// succeeds against a checkout that was itself exactly at a tag (fetch_nonraid_source() refuses to
// build from anything else - see its own comment) - so this file existing at all means "installed
// from a real release," never a mid-build or untagged-commit false positive.
const NONRAID_DRIVER_VERSION_FILE = '/etc/nonraid/driver-version';

// The kernel module carries no embedded version string of its own (confirmed live - `modinfo
// md_nonraid` has no version: field, and there's no /sys/module/md_nonraid/version) - so whether
// the currently *loaded* module is the one on disk right now is inferred from timing instead, see
// isDriverLoadedCurrent() below.
const DRIVER_MODULE_SYSFS_PATH = '/sys/module/md_nonraid';

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
  /** Whether the currently-*loaded* kernel module is the one actually on disk right now - null
   *  when the distinction doesn't apply (nonraidWebui: this very process restarts itself in place
   *  on update, so "installed" and "running" are the same thing by construction) or can't be
   *  determined (module not loaded, or no installed version recorded yet). false means a build
   *  happened since the module was last (re)loaded - Settings > Services' reload picks it up.
   *  Only ever meaningful for nonraid - see isDriverLoadedCurrent(). */
  runningMatchesInstalled: boolean | null;
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

/**
 * Whether the currently-loaded kernel module is at least as new as what's on disk right now.
 * Since the module has no version of its own to read (see DRIVER_MODULE_SYSFS_PATH's own
 * comment), this compares *when* each last changed instead: the module's sysfs directory is
 * recreated - its mtime bumped - every time modprobe (re)loads it, both on an explicit reload
 * (routes/array.ts's /array/reload-driver, /system/reload-driver) and on every plain reboot alike
 * (nonraid.service's own modprobe, in the separate nonraid repo - this app has no boot-time
 * module-loading logic of its own to hook into for that case). NONRAID_DRIVER_VERSION_FILE only
 * ever changes when build_nonraid_driver() stamps a fresh build. If the module's mtime is older
 * than the version file's, a build happened since the module was last loaded - true either way
 * requires no explicit bookkeeping, and self-corrects on the next reload or reboot regardless of
 * how it got out of sync.
 */
async function isDriverLoadedCurrent(): Promise<boolean | null> {
  try {
    const [moduleStat, versionStat] = await Promise.all([stat(DRIVER_MODULE_SYSFS_PATH), stat(NONRAID_DRIVER_VERSION_FILE)]);
    return moduleStat.mtimeMs >= versionStat.mtimeMs;
  } catch {
    return null; // module not loaded, or no installed version recorded yet - "can't tell"
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

export type UpdateComponentKey = 'nonraid' | 'nonraidWebui';

/** Keeps NONRAID_REPO_URL/NONRAID_WEBUI_REPO_URL themselves private to this module (every other
 *  caller already goes through checkForUpdates instead) while still letting routes/update.ts turn
 *  a request's ?component= into the right repo for fetchReleaseNotes below. */
export function repoUrlForComponent(component: UpdateComponentKey): string {
  return component === 'nonraid' ? NONRAID_REPO_URL : NONRAID_WEBUI_REPO_URL;
}

const GITHUB_API_TIMEOUT_MS = 10_000;

/** The rendered Markdown body of the GitHub Release for `tag` on `repoUrl`, or null when that tag
 *  has no associated Release object (e.g. a plain pushed tag with nothing published through
 *  GitHub's own Releases UI/API) - "nothing to show," not an error. Only ever called on demand
 *  (Settings > Update's "Changelog" link), not part of checkForUpdates' own cached/polled check -
 *  release notes are opt-in reading, not something worth a live GitHub call on every status poll. */
export async function fetchReleaseNotes(repoUrl: string, tag: string): Promise<string | null> {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) throw new Error(`Not a github.com repo URL: ${repoUrl}`);
  const [, owner, repo] = match;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_API_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`could not reach api.github.com: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
  const data = (await res.json()) as { body?: string | null };
  return data.body?.trim() || null;
}

async function checkComponent(installed: string | null, repoUrl: string, runningMatchesInstalled: boolean | null = null): Promise<ComponentUpdateStatus> {
  try {
    const latest = await latestTag(repoUrl);
    // Exact match, not a prefix/fuzzy comparison - both sides are real tag names now, not commit
    // hashes, so "the same tag" is the only thing "up to date" can mean. null on either side means
    // "can't tell" (no release installed from / no release published yet), not "no".
    const upToDate = installed && latest ? installed === latest : null;
    return { installed, latest, upToDate, checkError: null, runningMatchesInstalled };
  } catch (err) {
    return { installed, latest: null, upToDate: null, checkError: (err as Error).message, runningMatchesInstalled };
  }
}

// Simple in-memory cache: checking GitHub on every dashboard load/poll would be a live network
// round trip for no reason most of the time. `checkForUpdates(false)` (the status-route default)
// serves the cached result and never blocks on the network; only an explicit "Check for updates
// now" (force=true) or an empty cache does a live check.
let cached: UpdateStatus | null = null;

export async function checkForUpdates(force: boolean): Promise<UpdateStatus> {
  if (cached && !force) return cached;

  const [installedDriverTag, driverLoadedCurrent] = await Promise.all([readInstalledDriverTag(), isDriverLoadedCurrent()]);
  const [nonraid, nonraidWebui] = await Promise.all([
    checkComponent(installedDriverTag, NONRAID_REPO_URL, driverLoadedCurrent),
    // null (not a computed value) - nonraidWebui restarts itself in place on update (see
    // routes/update.ts), so "installed" vs "running" isn't a real question for it the way it is
    // for the driver (see ComponentUpdateStatus.runningMatchesInstalled's own doc comment).
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
      nonraid: { installed: null, latest: null, upToDate: null, checkError: null, runningMatchesInstalled: null },
      nonraidWebui: { installed: null, latest: null, upToDate: null, checkError: null, runningMatchesInstalled: null },
      checkedAt: null,
    }
  );
}
