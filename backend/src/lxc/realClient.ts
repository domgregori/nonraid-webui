import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
import type { LxcClient } from './client.js';
import { getVariable, readRaw, setVariables, writeRaw } from './configFile.js';
import { DEFAULT_ARCH, FALLBACK_DISTROS, labelFor } from './distros.js';
import { LxcStatsPoller } from './statsPoller.js';
import type {
  CreateLxcContainerOptions,
  CreateLxcProgressCallback,
  LxcCommandResult,
  LxcContainerDetail,
  LxcContainerSummary,
  LxcDistroOption,
  LxcRuntimeState,
} from './types.js';

const execFileAsync = promisify(execFile);

const DESCRIPTION_KEY = '#container_description';
const WEBUI_KEY = '#container_webui';
const AUTOSTART_KEY = 'lxc.start.auto';
// Fixed, obviously-synthetic name used only to satisfy lxc-create's
// mandatory -n flag when probing the download template's image index —
// see listDistros(). Not user-facing, never actually persists a container.
const DISTRO_LIST_PROBE_NAME = '__nonraid_lxc_distro_probe';

function containerDir(name: string): string {
  return path.join(config.lxcDefaultPath, name);
}

function containerConfigPath(name: string): string {
  return path.join(containerDir(name), 'config');
}

function parseState(raw: string): LxcRuntimeState {
  const s = raw.trim().toUpperCase();
  if (s === 'RUNNING') return 'running';
  if (s === 'STOPPED') return 'stopped';
  if (s === 'FROZEN') return 'frozen';
  return 'unknown';
}

function stripDirPrefix(rootfsValue: string | null): string | null {
  if (!rootfsValue) return null;
  return rootfsValue.startsWith('dir:') ? rootfsValue.slice(4) : rootfsValue;
}

function parseMemLimitBytes(raw: string | null): number | null {
  if (!raw || raw === 'max' || raw === '-1') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function randomLocallyAdministeredMac(): string {
  // 52:54:00: is the standard QEMU/KVM locally-administered OUI prefix — the
  // same one the reference plugin generates, implying bridged veth
  // networking rather than a routable, vendor-assigned address.
  const suffix = Array.from(randomBytes(3), (b) => b.toString(16).padStart(2, '0')).join(':');
  return `52:54:00:${suffix}`;
}

export class RealLxcClient implements LxcClient {
  readonly mode = 'real' as const;
  private stats = new LxcStatsPoller();

  private async run(bin: string, args: string[], timeoutMs = config.lxcTimeoutMs): Promise<{ stdout: string; stderr: string }> {
    const cmd = config.lxcUseSudo ? 'sudo' : bin;
    const fullArgs = config.lxcUseSudo ? [bin, ...args] : args;
    return execFileAsync(cmd, fullArgs, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
  }

  /** Unlike `lxc-info`, this build's `lxc-ls` has no `-H`/`--no-humanize` — its
   * `--fancy` output always prints a header row, so skip the first line. */
  private async listNames(): Promise<{ name: string; state: LxcRuntimeState; autostart: boolean }[]> {
    const { stdout } = await this.run('lxc-ls', ['-P', config.lxcDefaultPath, '--fancy', '--fancy-format=NAME,STATE,AUTOSTART']);
    return stdout
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, state, autostart] = line.split(/\s+/);
        return { name: name ?? '', state: parseState(state ?? ''), autostart: (autostart ?? '').toUpperCase() === 'YES' };
      })
      .filter((entry) => entry.name !== '');
  }

  private async getState(name: string): Promise<LxcRuntimeState> {
    try {
      const { stdout } = await this.run('lxc-info', ['-P', config.lxcDefaultPath, '-n', name, '-s', '-H']);
      return parseState(stdout);
    } catch {
      return 'unknown';
    }
  }

  private async getPid(name: string): Promise<number | null> {
    try {
      const { stdout } = await this.run('lxc-info', ['-P', config.lxcDefaultPath, '-n', name, '-p', '-H']);
      const pid = Number(stdout.trim());
      return Number.isInteger(pid) && pid > 0 ? pid : null;
    } catch {
      return null;
    }
  }

  private async readMetadata(name: string): Promise<{ description: string | null; webUiUrl: string | null; autostart: boolean }> {
    const configPath = containerConfigPath(name);
    const [description, webUiUrl, autostartRaw] = await Promise.all([
      getVariable(configPath, DESCRIPTION_KEY),
      getVariable(configPath, WEBUI_KEY),
      getVariable(configPath, AUTOSTART_KEY),
    ]);
    return { description, webUiUrl, autostart: autostartRaw === '1' };
  }

  async listContainers(): Promise<LxcContainerSummary[]> {
    const entries = await this.listNames();
    return Promise.all(
      entries.map(async ({ name, state, autostart }): Promise<LxcContainerSummary> => {
        const meta = await this.readMetadata(name);
        const sample = state === 'running' ? this.stats.get(name) : null;
        return {
          name,
          state,
          autostart,
          description: meta.description,
          webUiUrl: meta.webUiUrl,
          cpuPercent: sample?.cpuPercent ?? null,
          memUsedBytes: sample?.memUsedBytes ?? null,
          memLimitBytes: null,
          ips: sample?.ips ?? [],
        };
      }),
    );
  }

  async inspectContainer(name: string): Promise<LxcContainerDetail> {
    const configPath = containerConfigPath(name);
    const [state, pid, meta, rootfsRaw, bridge, mac, cpuLimit, memLimitRaw] = await Promise.all([
      this.getState(name),
      this.getPid(name),
      this.readMetadata(name),
      getVariable(configPath, 'lxc.rootfs.path'),
      getVariable(configPath, 'lxc.net.0.link'),
      getVariable(configPath, 'lxc.net.0.hwaddr'),
      getVariable(configPath, 'lxc.cgroup2.cpuset.cpus').then((v) => v ?? getVariable(configPath, 'lxc.cgroup.cpuset.cpus')),
      getVariable(configPath, 'lxc.cgroup2.memory.max').then((v) => v ?? getVariable(configPath, 'lxc.cgroup.memory.limit_in_bytes')),
    ]);

    return {
      name,
      state,
      autostart: meta.autostart,
      description: meta.description,
      webUiUrl: meta.webUiUrl,
      pid,
      rootfsPath: stripDirPrefix(rootfsRaw),
      bridge,
      macAddress: mac,
      cpuLimit,
      memLimitBytes: parseMemLimitBytes(memLimitRaw),
    };
  }

  async startContainer(name: string): Promise<LxcCommandResult> {
    await this.run('lxc-start', ['-P', config.lxcDefaultPath, '-n', name]);
    return { ok: true, message: `Container "${name}" started` };
  }

  async stopContainer(name: string, options?: { force?: boolean }): Promise<LxcCommandResult> {
    const args = ['-P', config.lxcDefaultPath, '-n', name];
    args.push(options?.force ? '--kill' : `--timeout=${config.lxcStopTimeoutSec}`);
    await this.run('lxc-stop', args);
    return { ok: true, message: `Container "${name}" stopped` };
  }

  async restartContainer(name: string): Promise<LxcCommandResult> {
    await this.run('lxc-stop', ['-P', config.lxcDefaultPath, '-n', name, `--timeout=${config.lxcStopTimeoutSec}`]);
    await this.run('lxc-start', ['-P', config.lxcDefaultPath, '-n', name]);
    return { ok: true, message: `Container "${name}" restarted` };
  }

  async destroyContainer(name: string): Promise<LxcCommandResult> {
    await this.run('lxc-stop', ['-P', config.lxcDefaultPath, '-n', name, '--kill']).catch(() => {});
    await this.run('lxc-destroy', ['-P', config.lxcDefaultPath, '-n', name]);
    return { ok: true, message: `Container "${name}" destroyed` };
  }

  async getConfigText(name: string): Promise<string> {
    return readRaw(containerConfigPath(name));
  }

  async setConfigText(name: string, content: string): Promise<LxcCommandResult> {
    await writeRaw(containerConfigPath(name), content);
    return { ok: true, message: `Container "${name}" config saved` };
  }

  /**
   * A real Linux bridge always exposes a `/sys/class/net/<name>/bridge`
   * directory — checking for that is a reliable, naming-scheme-independent
   * way to find veth-attachable bridges, unlike guessing from interface name
   * prefixes (br-, eth-, bond-, vhost-, virbr- per the reference plugin —
   * that list is Unraid-specific and misses e.g. `lxcbr0`, the bridge
   * `lxc-net` itself creates by default on Debian/Ubuntu, or `docker0`).
   * Physical/predictable-named NICs (enp2s0, eth0, wlan0...) and loopback
   * correctly fall out of this check since they aren't bridges.
   *
   * Enumerates via `/sys/class/net` directly rather than
   * `os.networkInterfaces()` — that API silently omits interfaces with no
   * active carrier (observed: a freshly created, unattached `lxcbr0`/
   * `docker0` — both administratively up with an assigned IPv4 address, but
   * `NO-CARRIER` since nothing's plugged into them yet — never showed up in
   * its output at all, even though `ip addr show` sees them fine).
   */
  async listBridges(): Promise<string[]> {
    const names = await fs.readdir('/sys/class/net').catch(() => []);
    const bridges = await Promise.all(
      names.map(async (name) => {
        try {
          await fs.access(`/sys/class/net/${name}/bridge`);
          return name;
        } catch {
          return null;
        }
      }),
    );
    return bridges.filter((n): n is string => n !== null).sort();
  }

  /**
   * Fetches the live download-template image index via `lxc-create -n
   * <throwaway> -t download -- --list`.
   *
   * `-n`/`--name` is mandatory on `lxc-create` even for a pure listing
   * operation — omitting it (verified empirically, not documented) doesn't
   * error out up front; `lxc-create` instead falls back to treating a
   * literal argument as the name and actually starts creating a container
   * with that bogus name, leaving a stray directory behind. Passing a real
   * name isn't enough on its own either: even though the download
   * template's own `--list` prints the index and exits before doing any
   * actual creation work (confirmed: nothing appears on disk under a
   * throwaway `-P` — see below), there's still a window, while `lxc-create`
   * is running, where `lxc-ls`/`lxc-info` against that path can see a
   * half-registered container — observed directly: a concurrent
   * `listContainers()` poll caught `__nonraid_lxc_distro_probe` mid-flight
   * as a real (if stopped) entry in the container list for over a second.
   * Pointing `-P` at an isolated scratch directory instead of the real
   * `lxcDefaultPath` sidesteps that race entirely, rather than papering
   * over the symptom with a name-based filter on every list-facing method.
   *
   * Not routed through a hardcoded template script path (e.g.
   * `/usr/share/lxc/templates/lxc-download`, which is Debian/Ubuntu-
   * specific) — going through `lxc-create` resolves the template the same
   * way an actual create would.
   *
   * Only entries for `DEFAULT_ARCH` with the "default" variant are kept —
   * this backs the create form's distribution dropdown, which has a
   * separate, freely-editable architecture field, so surfacing every
   * arch/variant combination here would just be noise.
   */
  async listDistros(): Promise<{ distros: LxcDistroOption[]; defaultArch: string }> {
    try {
      const stdout = await this.runForDistroList();
      const seen = new Set<string>();
      const distros: LxcDistroOption[] = [];
      for (const rawLine of stdout.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('---') || line.startsWith('Downloading') || line.startsWith('DIST')) continue;
        const [distribution, release, arch, variant] = line.split(/\s+/);
        if (!distribution || !release || arch !== DEFAULT_ARCH || variant !== 'default') continue;
        const key = `${distribution}/${release}`;
        if (seen.has(key)) continue;
        seen.add(key);
        distros.push({ distribution, release, label: labelFor(distribution, release) });
      }
      if (distros.length === 0) throw new Error('Live image index returned no usable entries');
      return { distros, defaultArch: DEFAULT_ARCH };
    } catch {
      return { distros: FALLBACK_DISTROS, defaultArch: DEFAULT_ARCH };
    }
  }

  private async runForDistroList(): Promise<string> {
    const scratchPath = path.join(os.tmpdir(), 'nonraid-lxc-distro-probe');
    await fs.mkdir(scratchPath, { recursive: true });
    try {
      const { stdout } = await this.run(
        'lxc-create',
        ['-P', scratchPath, '-n', DISTRO_LIST_PROBE_NAME, '-t', 'download', '--', '--list'],
        config.lxcDistroListTimeoutMs,
      );
      return stdout;
    } catch (err) {
      const stdout = (err as { stdout?: string }).stdout;
      if (!stdout) throw err;
      return stdout;
    } finally {
      await fs.rm(scratchPath, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Runs `lxc-create --template download` to completion, streaming its
   * stdout/stderr as progress lines — the download template's own output is
   * plain text with no byte-level progress protocol (unlike Docker's
   * registry pulls), so there is no percentage to compute, only a message
   * per line. Uses `spawn` rather than `execFile` specifically so output can
   * be streamed as it arrives instead of buffered until exit.
   */
  private runCreateTemplate(args: string[], onProgress?: CreateLxcProgressCallback): Promise<void> {
    return new Promise((resolve, reject) => {
      const bin = config.lxcUseSudo ? 'sudo' : 'lxc-create';
      const fullArgs = config.lxcUseSudo ? ['lxc-create', ...args] : args;
      const child = spawn(bin, fullArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

      const watchdog = setTimeout(() => {
        child.kill('SIGKILL');
      }, config.lxcCreateTimeoutMs);
      watchdog.unref();

      let stderrTail = '';
      const forwardLines = (chunk: Buffer) => {
        for (const line of chunk.toString('utf8').split('\n')) {
          const trimmed = line.trim();
          if (trimmed) onProgress?.({ phase: 'creating', message: trimmed, percent: null });
        }
      };
      child.stdout.on('data', forwardLines);
      child.stderr.on('data', (chunk: Buffer) => {
        stderrTail = chunk.toString('utf8').trim() || stderrTail;
        forwardLines(chunk);
      });

      child.on('error', (err) => {
        clearTimeout(watchdog);
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(watchdog);
        if (code === 0) resolve();
        else reject(new Error(`lxc-create exited with code ${code}${stderrTail ? `: ${stderrTail}` : ''}`));
      });
    });
  }

  async createContainer(options: CreateLxcContainerOptions, onProgress?: CreateLxcProgressCallback): Promise<LxcCommandResult> {
    onProgress?.({
      phase: 'creating',
      message: `Downloading ${options.distribution} ${options.release} (${options.arch}) — this can take a while`,
      percent: null,
    });

    await this.runCreateTemplate(
      [
        '-P',
        config.lxcDefaultPath,
        '--name',
        options.name,
        '--bdev=dir',
        '--template',
        'download',
        '--',
        '--dist',
        options.distribution,
        '--release',
        options.release,
        '--arch',
        options.arch,
      ],
      onProgress,
    );

    onProgress?.({ phase: 'configuring', message: 'Writing network and metadata configuration', percent: null });
    const configPath = containerConfigPath(options.name);
    await setVariables(configPath, [
      ['lxc.net.0.type', 'veth'],
      ['lxc.net.0.link', options.bridge],
      ['lxc.net.0.flags', 'up'],
      ['lxc.net.0.hwaddr', randomLocallyAdministeredMac()],
      [AUTOSTART_KEY, options.autostart ? '1' : '0'],
      [DESCRIPTION_KEY, options.description.trim() || null],
      [WEBUI_KEY, options.webUiUrl.trim() || null],
    ]);

    onProgress?.({ phase: 'starting', message: 'Starting container', percent: null });
    await this.startContainer(options.name);
    return { ok: true, message: `Container "${options.name}" created and started` };
  }
}
