export interface BootDiskInfo {
  device: string; // parent physical disk, e.g. /dev/sda - not the root partition itself
  filesystem: string | null;
  usedBytes: number | null;
  totalBytes: number | null;
  model: string | null;
  tempCelsius: number | null;
  // Filesystem UUID of the root partition (lsblk), not a SMART/WWN identifier - most boot media
  // (cheap USB sticks especially) don't support SMART/ATA passthrough at all, confirmed live on
  // this project's own test rig (smartctl returns no usable data for it), so this is the only real
  // UUID available for the boot disk.
  uuid: string | null;
}

export interface NetworkInterfaceInfo {
  name: string;
  ipv4: string[];
  ipv6: string[];
  mac: string | null;
}

export interface SystemStats {
  hostname: string;
  // The process's effective IANA zone (Intl.DateTimeFormat, no subprocess) -
  // reflects the OS timezone Node inherited at startup.
  timezone: string;
  uptimeSeconds: number;
  cpuPercent: number;
  // Best-effort package temperature from the kernel's hwmon sysfs interface.
  // null when no recognized CPU temp driver is present (containers, VMs,
  // unusual hardware) - see cpuTemp.ts.
  cpuTempCelsius: number | null;
  memUsedBytes: number;
  memTotalBytes: number;
  // Short git commit hash the running backend was built from, or null when
  // not run from a git checkout (e.g. a packaged deployment with no .git).
  buildVersion: string | null;
  // Semantic version - see version.ts. Bumped by hand alongside package.json on release, not read
  // from package.json at runtime (a packaged deployment doesn't necessarily have that file).
  version: string;
  // The disk nonraid-webui itself runs from - not part of the array. null
  // when detection fails (unusual root filesystem setup, lsblk missing,
  // etc.) - never blocks the rest of this endpoint, same as buildVersion
  // degrading to null outside a git checkout.
  bootDisk: BootDiskInfo | null;
  // Live interface addresses only - deliberately doesn't attempt to report
  // DHCP vs static (that would mean parsing /etc/network/interfaces, which
  // risks stating something wrong about a setup this app doesn't manage).
  networkInterfaces: NetworkInterfaceInfo[];
}
