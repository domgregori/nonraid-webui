import { execFile } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { BUILD_TAG } from '../buildInfo.generated.js';

const execFileAsync = promisify(execFile);

// Versioning convention differs per repo now. nonraidWebui: a manually-pushed semver git tag
// (v0.1.0, v0.2.0, ...) marks a real release - nothing else counts. nonraid: bare upstream
// qvr/nonraid has no tags at all, so it's tracked by main's tip commit SHA instead.
const NONRAID_REPO_URL = 'https://github.com/qvr/nonraid.git';
const NONRAID_WEBUI_REPO_URL = 'https://github.com/domgregori/nonraid-webui.git';

const SEMVER_TAG_RE = /^v\d+\.\d+\.\d+$/;

// Written by tools/install-webui.sh's build_nonraid_driver(), only after a `dkms install` actually
// succeeds - holds the exact commit SHA of qvr/nonraid main that was built, so this file existing
// at all means "installed from a real build," never a mid-build false positive.
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
  /** What this component was actually built/installed from: a release tag (nonraidWebui) or a
   *  commit SHA (nonraid) - or null when nothing's been installed/stamped yet. */
  installed: string | null;
  /** The newest tag or commit SHA available upstream, matching `installed`'s own kind - or null
   *  when there's nothing to compare against yet or the last check attempt failed (checkError). */
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
  /** The installed `nwctl` CLI's own version (e.g. "0.1.0"), or null if it isn't installed.
   *  No latest/upToDate/update-button of its own here - it ships from the same repo/release as
   *  nonraidWebui and is rebuilt+reinstalled as part of that same update (see
   *  update/apply.ts's applyWebuiUpdate), never independently. */
  cliTool: string | null;
  /** epoch ms of the last live check (cache population), or null if one has never run. */
  checkedAt: number | null;
}

async function readInstalledDriverVersion(): Promise<string | null> {
  try {
    return (await readFile(NONRAID_DRIVER_VERSION_FILE, 'utf8')).trim() || null;
  } catch {
    return null;
  }
}

// Shells out to the real installed binary rather than reading cli/package.json off disk - this
// process (running staged in $INSTALL_ROOT/backend) has no fixed relative path back to the dev
// checkout's cli/ directory the way the CLI itself does (see cli/src/index.ts's own version
// lookup), but /usr/local/bin/nwctl is always the actual thing a user would run. Null (not
// a throw) covers "not installed yet" - a normal state before the first build_cli/install_cli run.
async function readCliToolVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(config.nonraidToolBin, ['--version']);
    return stdout.trim() || null;
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

/** The current tip commit SHA of `branch` on `repoUrl`, or null if that branch doesn't exist -
 *  no clone, just a ref listing. Throws the same way latestTag does on a real failure. */
async function latestCommit(repoUrl: string, branch = 'main'): Promise<string | null> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync('git', ['ls-remote', repoUrl, `refs/heads/${branch}`], {
      timeout: LS_REMOTE_TIMEOUT_MS,
    }));
  } catch (err) {
    throw new Error(`could not reach ${repoUrl}: ${(err as Error).message}`);
  }
  return stdout.split('\t')[0]?.trim() || null;
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
 *  has no associated Release object - "nothing to show," not an error. Always null for nonraid
 *  now (a commit SHA is never a real tag), which is correct: it has no releases to show.
 *  Only called on demand (Settings > Update's "Changelog" link), never part of checkForUpdates. */
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

/**
 * `upToDate === false` (a real installed tag that isn't the latest one) is the obvious case, but
 * `installed === null` with a real `latest` is just as actionable, not genuinely unknown - a
 * manually-built/dev install, or a fresh install from before this app tracked BUILD_TAG at all,
 * would otherwise never be offered an update no matter how far behind it actually is. Mirrored on
 * the frontend (components/settings/UpdateSection.tsx's own hasUpdateAvailable) for the button's
 * visibility - this one gates whether routes/update.ts's /update/apply actually lets the request
 * through, so the two have to agree or the button shows without working (confirmed live: fixing
 * only the frontend check left a visible "Update Now" that 409'd the moment it was clicked).
 * Genuinely unknown (checkError, or latest === null - no releases published yet / GitHub
 * unreachable) still isn't "available" either way.
 */
export function hasUpdateAvailable(component: ComponentUpdateStatus): boolean {
  if (component.upToDate === false) return true;
  return component.upToDate === null && component.installed === null && component.latest !== null;
}

async function checkComponent(
  installed: string | null,
  repoUrl: string,
  mode: 'tag' | 'commit',
  runningMatchesInstalled: boolean | null = null,
): Promise<ComponentUpdateStatus> {
  try {
    const latest = mode === 'tag' ? await latestTag(repoUrl) : await latestCommit(repoUrl);
    // Exact string match either way - both sides are the same kind of identifier (tag or SHA), so
    // "the same one" is the only thing "up to date" can mean. null on either side means "can't
    // tell", not "no".
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

  const [installedDriverVersion, driverLoadedCurrent] = await Promise.all([readInstalledDriverVersion(), isDriverLoadedCurrent()]);
  const [nonraid, nonraidWebui, cliTool] = await Promise.all([
    checkComponent(installedDriverVersion, NONRAID_REPO_URL, 'commit', driverLoadedCurrent),
    // null (not a computed value) - nonraidWebui restarts itself in place on update (see
    // routes/update.ts), so "installed" vs "running" isn't a real question for it the way it is
    // for the driver (see ComponentUpdateStatus.runningMatchesInstalled's own doc comment).
    checkComponent(BUILD_TAG, NONRAID_WEBUI_REPO_URL, 'tag'),
    readCliToolVersion(),
  ]);

  cached = { nonraid, nonraidWebui, cliTool, checkedAt: Date.now() };
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
      cliTool: null,
      checkedAt: null,
    }
  );
}
