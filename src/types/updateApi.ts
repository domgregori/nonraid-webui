// Mirrors backend/src/update/service.ts's ComponentUpdateStatus/UpdateStatus.
export interface ComponentUpdateStatus {
  /** The release tag this component was actually built/installed from (e.g. "v0.2.0"), or null
   *  when it wasn't built from a tagged release at all - true today for every fresh install until
   *  a first real release is cut, and also true for an ordinary dev checkout. */
  installed: string | null;
  /** The newest semver tag currently pushed to the repo, or null when there are no tags at all or
   *  the last check attempt failed (see checkError) - either way, null means "nothing to compare
   *  against," not an error on its own. */
  latest: string | null;
  /** null (not false) when installed or latest couldn't be determined - "unknown", not "no". */
  upToDate: boolean | null;
  checkError: string | null;
  /** Whether the currently-loaded kernel module is the one actually on disk right now - null when
   *  the distinction doesn't apply (nonraidWebui, which restarts itself in place on update) or
   *  can't be determined. false means a build happened since the module was last (re)loaded -
   *  Settings > Services' reload picks it up. Only ever meaningful for nonraid. */
  runningMatchesInstalled: boolean | null;
}

export interface UpdateStatus {
  nonraid: ComponentUpdateStatus;
  nonraidWebui: ComponentUpdateStatus;
  /** The installed nonraid-tool CLI's own version (e.g. "0.1.0"), or null if not installed - no
   *  latest/upToDate/update button of its own, it's rebuilt+reinstalled as part of the same
   *  nonraidWebui update, never independently. */
  cliTool: string | null;
  /** epoch ms of the last live check, or null if one has never run. */
  checkedAt: number | null;
}

export type UpdateComponent = 'nonraid' | 'nonraidWebui';

// Mirrors backend/src/routes/update.ts's GET /update/changelog response shape.
export interface ChangelogResult {
  tag: string;
  /** The GitHub Release's Markdown body, or null when that tag has no associated Release (a
   *  plain pushed tag with nothing published through GitHub's own Releases UI/API). */
  body: string | null;
}

// Mirrors backend/src/update/apply.ts's ApplyResult.
export interface ApplyResult {
  ok: boolean;
  message: string;
  /** Last ~200 lines of the install-webui.sh run's combined stdout+stderr - enough to explain a
   *  failure without shipping the whole log. */
  output: string;
}
