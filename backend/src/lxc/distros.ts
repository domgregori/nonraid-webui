import type { LxcDistroOption } from './types.js';

export const DEFAULT_ARCH = 'amd64';

/**
 * Used only when the live index fetch (RealLxcClient.listDistros(), which
 * shells out to `lxc-create --template download -- --list`) fails - no
 * network, tool not installed, etc. When the live fetch succeeds this list
 * plays no part; see FRIENDLY_LABELS below for how live entries get a human
 * label.
 */
export const FALLBACK_DISTROS: LxcDistroOption[] = [
  { distribution: 'debian', release: 'bookworm', label: 'Debian 12 (bookworm)' },
  { distribution: 'debian', release: 'trixie', label: 'Debian 13 (trixie)' },
  { distribution: 'ubuntu', release: 'noble', label: 'Ubuntu 24.04 (noble)' },
  { distribution: 'ubuntu', release: 'jammy', label: 'Ubuntu 22.04 (jammy)' },
  { distribution: 'alpine', release: '3.22', label: 'Alpine 3.22' },
  { distribution: 'alpine', release: 'edge', label: 'Alpine (edge)' },
  { distribution: 'archlinux', release: 'current', label: 'Arch Linux (current)' },
  { distribution: 'fedora', release: '43', label: 'Fedora 43' },
  { distribution: 'rockylinux', release: '9', label: 'Rocky Linux 9' },
  { distribution: 'almalinux', release: '9', label: 'AlmaLinux 9' },
];

/**
 * Cosmetic only - the image index gives us bare codenames/version numbers
 * (e.g. "bookworm", "9"), not marketing names. A missing entry just falls
 * back to `${distribution} ${release}` (see labelFor), which is already
 * clear on its own for most distros - this only exists to add the version
 * number alongside a codename for the handful of distros that use one.
 * Unlike FALLBACK_DISTROS, a stale/missing entry here can't break
 * container creation, only cosmetics, so there's no correctness pressure
 * to keep it exhaustive.
 */
const FRIENDLY_LABELS: Record<string, string> = {
  'debian/bookworm': 'Debian 12 (bookworm)',
  'debian/trixie': 'Debian 13 (trixie)',
  'debian/bullseye': 'Debian 11 (bullseye)',
  'debian/forky': 'Debian 14 (forky)',
  'ubuntu/noble': 'Ubuntu 24.04 (noble)',
  'ubuntu/jammy': 'Ubuntu 22.04 (jammy)',
  'archlinux/current': 'Arch Linux (current)',
  'alpine/edge': 'Alpine (edge)',
};

export function labelFor(distribution: string, release: string): string {
  return FRIENDLY_LABELS[`${distribution}/${release}`] ?? `${distribution} ${release}`;
}
