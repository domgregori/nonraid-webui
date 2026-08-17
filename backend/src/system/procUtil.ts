import { spawn } from 'node:child_process';

/** This process runs as root (see tools/install-webui.sh), so every command it shells out to just
 *  runs directly - no privilege escalation needed for raw block devices, root-owned config files,
 *  or host-config commands like hostnamectl/timedatectl. */
export function spawnMaybeSudo(bin: string, args: string[]) {
  return spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Runs a command via spawnMaybeSudo and collects its output as a promise - shared by every
 *  caller that needs a real command result rather than a live stream (hostConfig.ts, hdparm.ts). */
export function runSudoMaybe(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawnMaybeSudo(bin, args);
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
