import { execFile, spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { config } from '../config.js';
import type { NmdClient } from './client.js';
import type { NmdCommandResult, NmdStatusResponse, ParityCheckAction } from './types.js';

const execFileAsync = promisify(execFile);

/**
 * Shells out to the real nmdctl binary. Always passes -u (unattended) so
 * confirmation prompts that expect an interactive TTY don't hang the process,
 * and --no-color so output stays parseable.
 */
export class RealNmdClient implements NmdClient {
  readonly mode = 'real' as const;

  private async run(args: string[]): Promise<{ stdout: string; stderr: string }> {
    const baseArgs = ['-u', '--no-color'];
    if (config.nmdSuperblock) baseArgs.push('-s', config.nmdSuperblock);

    const bin = config.nmdUseSudo ? 'sudo' : config.nmdBin;
    const fullArgs = config.nmdUseSudo ? [config.nmdBin, ...baseArgs, ...args] : [...baseArgs, ...args];

    try {
      return await execFileAsync(bin, fullArgs, { timeout: config.nmdTimeoutMs, maxBuffer: 8 * 1024 * 1024 });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      throw new Error(e.stderr?.trim() || e.stdout?.trim() || e.message);
    }
  }

  /** Writes one command to /proc/nmdcmd — the driver interface nmdctl itself uses internally. */
  private async writeNmdCmd(cmd: string): Promise<void> {
    if (!config.nmdUseSudo) {
      await writeFile(config.nmdCmdPath, cmd);
      return;
    }

    // Async execFile has no `input` option (that's execFileSync-only) — use spawn
    // and write to stdin directly. `tee` takes the command on stdin, so there's no
    // shell string here for anything to (mis)interpret.
    await new Promise<void>((resolve, reject) => {
      const child = spawn('sudo', ['tee', config.nmdCmdPath], { timeout: config.nmdTimeoutMs });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `Failed to write to ${config.nmdCmdPath} (exit ${code})`));
      });
      child.stdin.write(cmd);
      child.stdin.end();
    });
  }

  async getStatus(): Promise<NmdStatusResponse> {
    const { stdout } = await this.run(['status', '-o', 'json']);
    return JSON.parse(stdout) as NmdStatusResponse;
  }

  async startArray(): Promise<NmdCommandResult> {
    const { stdout } = await this.run(['start']);
    return { ok: true, message: stdout.trim() };
  }

  async stopArray(): Promise<NmdCommandResult> {
    const { stdout } = await this.run(['stop']);
    return { ok: true, message: stdout.trim() };
  }

  async parityCheck(action: ParityCheckAction): Promise<NmdCommandResult> {
    const { stdout } = await this.run(['check', action]);
    return { ok: true, message: stdout.trim() };
  }

  async unassignDisk(slot: number): Promise<NmdCommandResult> {
    // Same safety checks nmdctl's own (interactive-only) unassign_disk() does,
    // read fresh right before acting.
    const status = await this.getStatus();

    if (status.array.state === 'STARTED') {
      throw new Error('Array must be stopped before unassigning disks.');
    }

    const disk = status.disks.find((d) => d.slot === slot);
    if (!disk || disk.status === 'DISK_NP_DSBL') {
      throw new Error(`No disk assigned to slot ${slot}, or it's already unassigned.`);
    }

    const parityCount = status.disks.filter((d) => (d.type === 'P' || d.type === 'Q') && d.size_gb > 0).length;
    const alreadyMissing = status.disks.filter((d) => d.status === 'DISK_NP_MISSING' || d.status === 'DISK_NP_DSBL').length;
    if (alreadyMissing + 1 > parityCount) {
      throw new Error(
        `Not enough parity to unassign another disk (parity disks: ${parityCount}, already missing: ${alreadyMissing}).`,
      );
    }

    // The exact command nmdctl's unassign_disk() issues internally — importing
    // the slot with an empty device unassigns it. Unassigning the same slot
    // twice is a known driver bug (bumps the missing-disk counter twice and
    // forces TOO_MANY_MISSING_DISKS, needing a driver reload) — the DISK_NP_DSBL
    // check above guards against that.
    await this.writeNmdCmd(`import ${slot} '' 0 0 0 ''`);

    return { ok: true, message: `Slot ${slot} unassigned. Start the array to commit the change.` };
  }
}
