import { spawn } from 'node:child_process';

/** Same sudo-wrapping shape as RealNmdClient's runSystem() — this process may not itself have
 *  permission to read a raw block device, root-owned config files, or run host-config commands
 *  like hostnamectl/timedatectl, only sudo does. */
export function spawnMaybeSudo(bin: string, args: string[], useSudo: boolean) {
  return spawn(useSudo ? 'sudo' : bin, useSudo ? [bin, ...args] : args, { stdio: ['ignore', 'pipe', 'pipe'] });
}
