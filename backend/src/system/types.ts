export interface SystemStats {
  hostname: string;
  uptimeSeconds: number;
  cpuPercent: number;
  memUsedBytes: number;
  memTotalBytes: number;
  // Short git commit hash the running backend was built from, or null when
  // not run from a git checkout (e.g. a packaged deployment with no .git).
  // package.json's own "version" is a static "0.0.0" that's never bumped in
  // this project, so it wouldn't tell an admin anything useful.
  buildVersion: string | null;
}
