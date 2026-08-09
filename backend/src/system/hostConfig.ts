import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { spawnMaybeSudo } from './procUtil.js';

const execFileAsync = promisify(execFile);

// RFC 1123 label: letters/digits/hyphens, 1–63 chars, can't start or end with a hyphen.
const HOSTNAME_PATTERN = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

function runSudoMaybe(bin: string, args: string[], useSudo: boolean): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnMaybeSudo(bin, args, useSudo);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `${bin} exited with code ${code}`));
    });
  });
}

export async function setHostname(name: string, useSudo: boolean): Promise<void> {
  if (!HOSTNAME_PATTERN.test(name)) {
    throw new Error('Hostname must be 1–63 characters, letters/digits/hyphens only, and can\'t start or end with a hyphen.');
  }
  await runSudoMaybe('hostnamectl', ['set-hostname', name], useSudo);
}

let cachedTimezones: string[] | null = null;

/** The IANA zone list never changes at runtime, so this is fetched once and cached — same
 *  reasoning as SystemStatsService caching its boot disk identity. */
export async function listTimezones(): Promise<string[]> {
  if (cachedTimezones) return cachedTimezones;
  const { stdout } = await execFileAsync('timedatectl', ['list-timezones']);
  cachedTimezones = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  return cachedTimezones;
}

export async function setTimezone(tz: string, useSudo: boolean): Promise<void> {
  const zones = await listTimezones();
  if (!zones.includes(tz)) {
    throw new Error(`"${tz}" isn't a recognized timezone.`);
  }
  await runSudoMaybe('timedatectl', ['set-timezone', tz], useSudo);
}
