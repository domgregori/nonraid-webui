import { spawn } from 'node:child_process';

/** Same sudo-wrapping shape as RealNmdClient's runSystem() — this process may not itself have
 *  permission to read a raw block device, root-owned config files, or run host-config commands
 *  like hostnamectl/timedatectl, only sudo does. */
export function spawnMaybeSudo(bin: string, args: string[], useSudo: boolean) {
  return spawn(useSudo ? 'sudo' : bin, useSudo ? [bin, ...args] : args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Runs a command via spawnMaybeSudo and collects its output as a promise — shared by every
 *  caller that needs a real command result rather than a live stream (hostConfig.ts, hdparm.ts). */
export function runSudoMaybe(bin: string, args: string[], useSudo: boolean): Promise<{ stdout: string; stderr: string }> {
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
