export interface BootDiskInfo {
  device: string; // parent physical disk, e.g. /dev/sda — not the root partition itself
  filesystem: string | null;
  usedBytes: number | null;
  totalBytes: number | null;
  model: string | null;
  tempCelsius: number | null;
}

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
  // The disk nonraid-webui itself runs from — not part of the array. null
  // when detection fails (unusual root filesystem setup, lsblk missing,
  // etc.) — never blocks the rest of this endpoint, same as buildVersion
  // degrading to null outside a git checkout.
  bootDisk: BootDiskInfo | null;
}
