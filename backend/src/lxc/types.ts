/**
 * Normalized shape, same reasoning as backend/src/docker/types.ts - not a
 * passthrough of raw `lxc-info`/config-file text. `frozen` covers
 * lxc-freeze/lxc-unfreeze even though Phase 1 doesn't expose those actions,
 * since `lxc-info` can still report a container in that state.
 */
export type LxcRuntimeState = 'running' | 'stopped' | 'frozen' | 'unknown';

export interface LxcSnapshot {
  name: string; // e.g. "snap0" - lxc-snapshot's own auto-generated name, not user-editable
  timestamp: string; // raw "YYYY:MM:DD HH:MM:SS" as lxc-snapshot -L prints it
  comment: string | null;
}

export interface LxcContainerSummary {
  name: string;
  state: LxcRuntimeState;
  autostart: boolean;
  description: string | null;
  webUiUrl: string | null;
  // Filled in by the stats poller (see statsPoller.ts) - null when stopped
  // or when no sample has landed yet.
  cpuPercent: number | null;
  memUsedBytes: number | null;
  memLimitBytes: number | null; // null when the container has no configured cgroup memory cap
  ips: string[];
}

export interface LxcCommandResult {
  ok: boolean;
  message: string;
}

export interface LxcContainerDetail {
  name: string;
  state: LxcRuntimeState;
  autostart: boolean;
  description: string | null;
  webUiUrl: string | null;
  pid: number | null;
  rootfsPath: string | null;
  bridge: string | null;
  macAddress: string | null;
  cpuLimit: string | null; // raw lxc.cgroup2.cpuset.cpus / lxc.cgroup.cpuset.cpus value, e.g. "0-1"
  memLimitBytes: number | null;
}

export interface CreateLxcContainerOptions {
  name: string;
  distribution: string;
  release: string;
  arch: string;
  // For 'bridge' (default), this is a host bridge the container's veth attaches to - the
  // container gets an IP on whatever subnet that bridge serves. For 'macvlan', this is a physical
  // NIC (e.g. eno0) the container's own virtual interface rides directly on - the container gets
  // its own IP straight from the LAN's DHCP server, indistinguishable from a separate physical
  // device on the network. Host-to-container traffic doesn't work over a macvlan link (a kernel
  // limitation, not a bug); container-to-LAN and container-to-container both work fine.
  networkType: 'bridge' | 'macvlan';
  bridge: string;
  autostart: boolean;
  description: string;
  webUiUrl: string;
}

export interface CreateLxcProgress {
  phase: 'creating' | 'configuring' | 'starting';
  message: string;
  // The download template's own output is plain progress text, not a
  // byte-counted protocol like Docker's registry API, so there's no reliable
  // percent to report - unlike CreateContainerProgress's docker equivalent.
  percent: null;
}

export type CreateLxcProgressCallback = (progress: CreateLxcProgress) => void;

// A curated, known-good subset of the linuxcontainers.org image server's
// catalog - the full index is large and mostly irrelevant noise (dozens of
// EOL releases/arches per distro). Phase 1 ships a fixed list rather than
// fetching+parsing the live index; revisit if users need something outside it.
export interface LxcDistroOption {
  distribution: string;
  release: string;
  label: string; // e.g. "Debian 12 (bookworm)"
}
