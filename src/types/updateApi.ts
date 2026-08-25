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
}

export interface UpdateStatus {
  nonraid: ComponentUpdateStatus;
  nonraidWebui: ComponentUpdateStatus;
  /** epoch ms of the last live check, or null if one has never run. */
  checkedAt: number | null;
}

export type UpdateComponent = 'nonraid' | 'nonraidWebui';

// Mirrors backend/src/update/apply.ts's ApplyResult.
export interface ApplyResult {
  ok: boolean;
  message: string;
  /** Last ~200 lines of the install-webui.sh run's combined stdout+stderr - enough to explain a
   *  failure without shipping the whole log. */
  output: string;
}
