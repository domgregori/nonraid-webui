import { execFile, spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { config } from '../config.js';
import type { NmdClient } from './client.js';
import type { ImportResult, NmdCommandResult, NmdStatusResponse, ParityCheckAction } from './types.js';

const execFileAsync = promisify(execFile);

/**
 * Parses `nmdctl -u --no-color import`'s stdout. The command itself always
 * exits 0 even when some disks were skipped (a size mismatch, a missing
 * physical disk, etc.) — see import_disks() in tools/nmdctl, the main
 * nonraid repo — so the only way to detect those conditions is text parsing,
 * not the exit code.
 */
function parseImportOutput(output: string): ImportResult {
  const lines = output.split('\n');
  const mismatchSizes = new Map<number, { partitionSizeKb: number | null; expectedSizeKb: number | null }>();
  const skippedSlots = new Set<number>();
  const errors: string[] = [];
  let importedCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim();

    const sizeWarning = line.match(/^Warning: Size mismatch for disk in slot (\d+)$/);
    if (sizeWarning) {
      const slot = Number(sizeWarning[1]);
      const partitionSizeKb = Number(lines[i + 1]?.match(/Partition size: (\d+) KB/)?.[1]);
      const expectedSizeKb = Number(lines[i + 2]?.match(/Expected size\s*: (\d+) KB/)?.[1]);
      mismatchSizes.set(slot, {
        partitionSizeKb: Number.isFinite(partitionSizeKb) ? partitionSizeKb : null,
        expectedSizeKb: Number.isFinite(expectedSizeKb) ? expectedSizeKb : null,
      });
      continue;
    }

    const skipped = line.match(/^Error: Size mismatch for disk in slot (\d+) \(unattended mode\)$/);
    if (skipped) {
      skippedSlots.add(Number(skipped[1]));
      continue;
    }

    const successCount = line.match(/^Successfully imported (\d+) disk\(s\)$/);
    if (successCount) {
      importedCount = Number(successCount[1]);
      continue;
    }

    if (line.startsWith('Error:')) errors.push(line);
  }

  const sizeMismatches = [...skippedSlots].map((slot) => ({
    slot,
    partitionSizeKb: mismatchSizes.get(slot)?.partitionSizeKb ?? null,
    expectedSizeKb: mismatchSizes.get(slot)?.expectedSizeKb ?? null,
  }));

  return { importedCount, sizeMismatches, errors, output };
}

/**
 * Shells out to the real nmdctl binary. Always passes -u (unattended) so
 * confirmation prompts that expect an interactive TTY don't hang the process,
 * and --no-color so output stays parseable.
 */
export class RealNmdClient implements NmdClient {
  readonly mode = 'real' as const;

  private nmdArgs(args: string[]): { bin: string; fullArgs: string[] } {
    const baseArgs = ['-u', '--no-color'];
    if (config.nmdSuperblock) baseArgs.push('-s', config.nmdSuperblock);
    const bin = config.nmdUseSudo ? 'sudo' : config.nmdBin;
    const fullArgs = config.nmdUseSudo ? [config.nmdBin, ...baseArgs, ...args] : [...baseArgs, ...args];
    return { bin, fullArgs };
  }

  private async run(args: string[]): Promise<{ stdout: string; stderr: string }> {
    const { bin, fullArgs } = this.nmdArgs(args);
    try {
      return await execFileAsync(bin, fullArgs, { timeout: config.nmdTimeoutMs, maxBuffer: 8 * 1024 * 1024 });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      throw new Error(e.stderr?.trim() || e.stdout?.trim() || e.message);
    }
  }

  /**
   * `status -o json`'s exit code mirrors the array's own health code (see
   * ARRAY_STATUS_DATA/health logic in tools/nmdctl) — nonzero means "not
   * fully healthy" (stopped, degraded, new, ...), not "the command failed".
   * The JSON on stdout is still complete either way, so this tries to parse
   * it before falling back to run()'s normal throw-on-nonzero-exit behavior,
   * unlike every other command here where a nonzero exit really is a failure.
   */
  private async runStatusJson(args: string[]): Promise<string> {
    const { bin, fullArgs } = this.nmdArgs(args);
    try {
      return (await execFileAsync(bin, fullArgs, { timeout: config.nmdTimeoutMs, maxBuffer: 8 * 1024 * 1024 })).stdout;
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message: string };
      if (e.stdout) {
        try {
          JSON.parse(e.stdout);
          return e.stdout;
        } catch {
          // stdout wasn't valid JSON either — a real failure, fall through to throw below
        }
      }
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
    const stdout = await this.runStatusJson(['status', '-o', 'json']);
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

  async unmountDisks(): Promise<NmdCommandResult> {
    const { stdout } = await this.run(['unmount']);
    return { ok: true, message: stdout.trim() };
  }

  async mountDisks(): Promise<NmdCommandResult> {
    const { stdout } = await this.run(['mount']);
    return { ok: true, message: stdout.trim() };
  }

  async parityCheck(action: ParityCheckAction): Promise<NmdCommandResult> {
    const { stdout } = await this.run(['check', action]);
    return { ok: true, message: stdout.trim() };
  }

  async setWriteMethod(turbo: boolean): Promise<NmdCommandResult> {
    const { stdout } = await this.run(['set', 'md_write_method', turbo ? '1' : '0']);
    return { ok: true, message: stdout.trim() };
  }

  async setLabel(label: string): Promise<NmdCommandResult> {
    const { stdout } = await this.run(['set', 'label', label]);
    return { ok: true, message: stdout.trim() };
  }

  async importDisks(): Promise<ImportResult> {
    const { stdout } = await this.run(['import']);
    return parseImportOutput(stdout);
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
