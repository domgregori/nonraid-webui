import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runSudoMaybe } from './procUtil.js';

const execFileAsync = promisify(execFile);

// RFC 1123 label: letters/digits/hyphens, 1-63 chars, can't start or end with a hyphen.
const HOSTNAME_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

export async function setHostname(name: string): Promise<void> {
  if (!HOSTNAME_PATTERN.test(name)) {
    throw new Error('Hostname must be 1-63 characters, letters/digits/hyphens only, and can\'t start or end with a hyphen.');
  }
  await runSudoMaybe('hostnamectl', ['set-hostname', name]);
}

let cachedTimezones: string[] | null = null;

/** The IANA zone list never changes at runtime, so this is fetched once and cached - same
 *  reasoning as SystemStatsService caching its boot disk identity. */
export async function listTimezones(): Promise<string[]> {
  if (cachedTimezones) return cachedTimezones;
  const { stdout } = await execFileAsync('timedatectl', ['list-timezones']);
  cachedTimezones = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  return cachedTimezones;
}

export async function setTimezone(tz: string): Promise<void> {
  const zones = await listTimezones();
  if (!zones.includes(tz)) {
    throw new Error(`"${tz}" isn't a recognized timezone.`);
  }
  await runSudoMaybe('timedatectl', ['set-timezone', tz]);
}

// `systemctl reboot` only *schedules* the shutdown and returns immediately - it doesn't block
// until the host actually goes down, so this resolves in well under a second regardless of how
// long the real shutdown sequence takes. That sequence is the normal, graceful one (every unit's
// own ExecStop runs in order - nonraid.service unmounts and stops the array, docker/lxc/samba/nfs
// stop cleanly), not a hard cut, so nothing extra needs to happen here first.
export async function rebootHost(): Promise<void> {
  await runSudoMaybe('systemctl', ['reboot']);
}
