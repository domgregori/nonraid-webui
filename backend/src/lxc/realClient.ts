import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.js';
import type { LxcClient } from './client.js';
import { getVariable, readRaw, setVariable, setVariables, writeRaw } from './configFile.js';
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
  LxcSnapshot,
} from './types.js';

const execFileAsync = promisify(execFile);

const DESCRIPTION_KEY = '#container_description';
const WEBUI_KEY = '#container_webui';
// Stamped at creation time only (see createContainer() below) - LXC itself has no notion of "what
// template was this built from", unlike Docker's image string. A container created before this
// field existed simply has no value here; that's a normal, permanent state, not an error - the
// frontend's DistroIcon falls back to a plain letter mark when this is null.
const DISTRIBUTION_KEY = '#container_distribution';
const AUTOSTART_KEY = 'lxc.start.auto';
// Fixed, obviously-synthetic name used only to satisfy lxc-create's
// mandatory -n flag when probing the download template's image index -
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
  // 52:54:00: is the standard QEMU/KVM locally-administered OUI prefix - the
  // same one the reference plugin generates, implying bridged veth
  // networking rather than a routable, vendor-assigned address.
  const suffix = Array.from(randomBytes(3), (b) => b.toString(16).padStart(2, '0')).join(':');
  return `52:54:00:${suffix}`;
}

export class RealLxcClient implements LxcClient {
  private stats = new LxcStatsPoller();

  private async run(bin: string, args: string[], timeoutMs = config.lxcTimeoutMs): Promise<{ stdout: string; stderr: string }> {
    try {
      return await execFileAsync(bin, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 });
    } catch (err) {
      // Node's raw spawn failure (e.g. "spawn lxc-ls ENOENT") is accurate but
      // not exactly self-explanatory on a dashboard - the actual missing
      // piece is the lxc-utils package, not literally the word "spawn".
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        throw new Error(`'${bin}' not found - lxc-utils isn't installed on this host.`);
      }
      throw err;
    }
  }

  /** Unlike `lxc-info`, this build's `lxc-ls` has no `-H`/`--no-humanize` - its
   * `--fancy` output always prints a header row, so skip the first line. AUTOSTART isn't parsed
   * out of this even though the column exists - readMetadata() below already reads lxc.start.auto
   * straight off the container's config, the same source setContainerAutostart()/createContainer()
   * write to, rather than trusting this build's --fancy AUTOSTART column format (observed as a
   * bare "1"/"0" on this host, not the "YES"/"NO" some lxc-ls builds print). */
  private async listNames(): Promise<{ name: string; state: LxcRuntimeState }[]> {
    const { stdout } = await this.run('lxc-ls', ['-P', config.lxcDefaultPath, '--fancy', '--fancy-format=NAME,STATE']);
    return stdout
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, state] = line.split(/\s+/);
        return { name: name ?? '', state: parseState(state ?? '') };
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

  private async pidAlive(pid: number): Promise<boolean> {
    try {
      await fs.access(`/proc/${pid}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Stops a container and confirms its init process actually exited. `lxc-stop`
   * can return while the container's init + children survive as an orphaned
   * process tree (`lxc-ls` then reports it as not running), leaving the rootfs
   * overlay mounted and holding the array disk "in use" - which then blocks
   * `nmdctl stop` with EBUSY. Escalates graceful -> `lxc-stop --kill` -> a
   * direct SIGKILL of the init PID (killing a PID namespace's init makes the
   * kernel SIGKILL every other process in that namespace, tearing down the
   * orphaned mounts). Observed on the test rig (Aug 2026) with container
   * "alpiney".
   */
  private async stopAndVerify(name: string, force: boolean): Promise<void> {
    // Capture the init PID *before* stopping - lxc-info reports it reliably while
    // the container is running, but after lxc-stop has (mis)reported success it can
    // claim "not running" even though the init is orphaned, so a post-stop query
    // can't be trusted to detect the leak.
    const initPid = await this.getPid(name);

    const args = ['-P', config.lxcDefaultPath, '-n', name];
    args.push(force ? '--kill' : `--timeout=${config.lxcStopTimeoutSec}`);
    // Node's own process timeout must outlast the `--timeout` we just told lxc-stop to honor -
    // otherwise Node kills the still-gracefully-shutting-down process first and reports a bogus
    // failure (observed live: a container took a little over lxcTimeoutMs's default 15s to stop,
    // Node SIGTERM'd lxc-stop before its own 30s grace period ended, and a manual immediate retry
    // then succeeded in under a second since the container was already stopping).
    await this.run('lxc-stop', args, (config.lxcStopTimeoutSec + 5) * 1000);

    if (initPid === null) return;

    if (await this.pidAlive(initPid)) {
      await this.run('lxc-stop', ['-P', config.lxcDefaultPath, '-n', name, '--kill']).catch(() => {});
      if (await this.pidAlive(initPid)) {
        try {
          process.kill(initPid, 'SIGKILL');
        } catch {
          // exited between the liveness check and the kill
        }
      }
    }
  }

  private async readMetadata(
    name: string,
  ): Promise<{ description: string | null; webUiUrl: string | null; autostart: boolean; distribution: string | null }> {
    const configPath = containerConfigPath(name);
    const [description, webUiUrl, autostartRaw, distribution] = await Promise.all([
      getVariable(configPath, DESCRIPTION_KEY),
      getVariable(configPath, WEBUI_KEY),
      getVariable(configPath, AUTOSTART_KEY),
      getVariable(configPath, DISTRIBUTION_KEY),
    ]);
    return { description, webUiUrl, autostart: autostartRaw === '1', distribution };
  }

  async listContainers(): Promise<LxcContainerSummary[]> {
    const entries = await this.listNames();
    return Promise.all(
      entries.map(async ({ name, state }): Promise<LxcContainerSummary> => {
        const meta = await this.readMetadata(name);
        const sample = state === 'running' ? this.stats.get(name) : null;
        return {
          name,
          state,
          autostart: meta.autostart,
          description: meta.description,
          webUiUrl: meta.webUiUrl,
          distribution: meta.distribution,
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
      distribution: meta.distribution,
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
    await this.stopAndVerify(name, options?.force ?? false);
    return { ok: true, message: `Container "${name}" stopped` };
  }

  async restartContainer(name: string): Promise<LxcCommandResult> {
    await this.stopAndVerify(name, false);
    await this.run('lxc-start', ['-P', config.lxcDefaultPath, '-n', name]);
    return { ok: true, message: `Container "${name}" restarted` };
  }

  async setContainerAutostart(name: string, autostart: boolean): Promise<LxcCommandResult> {
    await setVariable(containerConfigPath(name), AUTOSTART_KEY, autostart ? '1' : '0');
    return { ok: true, message: `Container "${name}" autostart ${autostart ? 'enabled' : 'disabled'}` };
  }

  async destroyContainer(name: string): Promise<LxcCommandResult> {
    await this.stopAndVerify(name, true).catch(() => {});
    // -s: also destroy any snapshots - without it, lxc-destroy refuses outright ("container has
    // snapshots") the moment a container has ever been snapshotted, confirmed live. A snapshot is
    // this app's own feature now, so cascading its cleanup into the normal Destroy flow is the
    // right default rather than surfacing that refusal as a dead end.
    await this.run('lxc-destroy', ['-P', config.lxcDefaultPath, '-n', name, '-s']);
    return { ok: true, message: `Container "${name}" destroyed` };
  }

  /**
   * `lxc-snapshot -L -C` output is "No snapshots" (exit 0) when there are none, otherwise one
   * header line per snapshot - "<name> (<path>) <YYYY:MM:DD HH:MM:SS>" - immediately followed by
   * a comment line *only* if that snapshot has one (no blank placeholder line when it doesn't;
   * confirmed live). This app only ever writes single-line comments (see createSnapshot), so a
   * non-header line is unambiguously the single comment belonging to the header directly above it.
   */
  async listSnapshots(name: string): Promise<LxcSnapshot[]> {
    const { stdout } = await this.run('lxc-snapshot', ['-P', config.lxcDefaultPath, '-n', name, '-L', '-C']);
    if (stdout.trim() === 'No snapshots') return [];
    const headerRe = /^(\S+)\s+\([^)]*\)\s+(\d{4}:\d{2}:\d{2}\s+\d{2}:\d{2}:\d{2})$/;
    const snapshots: LxcSnapshot[] = [];
    for (const line of stdout.split('\n')) {
      const match = line.match(headerRe);
      if (match) {
        snapshots.push({ name: match[1]!, timestamp: match[2]!, comment: null });
      } else if (line.trim() && snapshots.length > 0) {
        snapshots[snapshots.length - 1]!.comment = line.trim();
      }
    }
    return snapshots;
  }

  // -c takes a *file* to read the comment from, not inline text - write one to a scratch temp
  // file rather than requiring the caller to manage that.
  async createSnapshot(name: string, comment: string): Promise<LxcCommandResult> {
    const args = ['-P', config.lxcDefaultPath, '-n', name];
    let commentPath: string | null = null;
    if (comment.trim()) {
      commentPath = path.join(os.tmpdir(), `nonraid-lxc-snapshot-comment-${randomBytes(8).toString('hex')}`);
      await fs.writeFile(commentPath, comment.trim(), 'utf8');
      args.push('-c', commentPath);
    }
    try {
      await this.run('lxc-snapshot', args);
    } finally {
      if (commentPath) await fs.unlink(commentPath).catch(() => {});
    }
    return { ok: true, message: `Snapshot of "${name}" created` };
  }

  // newName is always required - see the client.ts interface doc comment for why this app never
  // lets "restore" silently default to in-place (same name = replace original, confirmed live;
  // this app's own UI treats that as a distinct, explicitly-confirmed danger action instead).
  async restoreSnapshot(name: string, snapshotName: string, newName: string): Promise<LxcCommandResult> {
    await this.run('lxc-snapshot', ['-P', config.lxcDefaultPath, '-n', name, '-r', snapshotName, '-N', newName]);
    const inPlace = newName === name;
    return {
      ok: true,
      message: inPlace ? `"${name}" restored from ${snapshotName}` : `Restored ${snapshotName} as new container "${newName}"`,
    };
  }

  async deleteSnapshot(name: string, snapshotName: string): Promise<LxcCommandResult> {
    try {
      await this.run('lxc-snapshot', ['-P', config.lxcDefaultPath, '-n', name, '-d', snapshotName]);
    } catch (err) {
      // Confirmed live: overlayfs snapshots that another container was restored *from* can't be
      // deleted while that derived container still exists (it's a dependent CoW layer, not a free
      // copy) - surface that plainly instead of the raw "has snapshots on its rootfs" LXC error.
      const message = (err as { stderr?: string; message: string }).stderr ?? (err as Error).message;
      if (message.includes('has snapshots on its rootfs')) {
        throw new Error(`Can't delete "${snapshotName}" - a container restored from it still exists. Destroy that container first.`);
      }
      throw err;
    }
    return { ok: true, message: `Snapshot "${snapshotName}" deleted` };
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
   * directory - checking for that is a reliable, naming-scheme-independent
   * way to find veth-attachable bridges, unlike guessing from interface name
   * prefixes (br-, eth-, bond-, vhost-, virbr- per the reference plugin -
   * that list is specific to a different host OS's own conventions and misses
   * e.g. `lxcbr0`, the bridge `lxc-net` itself creates by default on
   * Debian/Ubuntu, or `docker0`).
   * Physical/predictable-named NICs (enp2s0, eth0, wlan0...) and loopback
   * correctly fall out of this check since they aren't bridges.
   *
   * Enumerates via `/sys/class/net` directly rather than
   * `os.networkInterfaces()` - that API silently omits interfaces with no
   * active carrier (observed: a freshly created, unattached `lxcbr0`/
   * `docker0` - both administratively up with an assigned IPv4 address, but
   * `NO-CARRIER` since nothing's plugged into them yet - never showed up in
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
    // lxcbr0 - the lxc package's own default bridge, set up specifically for container
    // connectivity - sorts first when present, so it (not docker0, or any other bridge that
    // happens to alphabetize earlier) is what a fresh container defaults to. Everything else stays
    // plain alphabetical.
    return bridges
      .filter((n): n is string => n !== null)
      .sort((a, b) => {
        if (a === 'lxcbr0') return -1;
        if (b === 'lxcbr0') return 1;
        return a.localeCompare(b);
      });
  }

  /**
   * A real physical NIC always exposes a `/sys/class/net/<name>/device` symlink pointing at its
   * backing PCI/USB device - the kernel's own marker for "this is real hardware", mirroring how
   * listBridges() above uses the `bridge` subdirectory as the marker for "this is a bridge".
   * Purely virtual interfaces (bridges, veth pairs, bonds, VLAN sub-interfaces, loopback) have no
   * such symlink, so they're correctly excluded without needing a name-prefix guess (eno0/enp2s0/
   * eth0/wlan0 all pass this check equally, unlike guessing from naming convention).
   */
  async listPhysicalInterfaces(): Promise<string[]> {
    const names = await fs.readdir('/sys/class/net').catch(() => []);
    const interfaces = await Promise.all(
      names.map(async (name) => {
        try {
          await fs.access(`/sys/class/net/${name}/device`);
          return name;
        } catch {
          return null;
        }
      }),
    );
    return interfaces.filter((n): n is string => n !== null).sort();
  }

  /**
   * Fetches the live download-template image index via `lxc-create -n
   * <throwaway> -t download -- --list`.
   *
   * `-n`/`--name` is mandatory on `lxc-create` even for a pure listing
   * operation - omitting it (verified empirically, not documented) doesn't
   * error out up front; `lxc-create` instead falls back to treating a
   * literal argument as the name and actually starts creating a container
   * with that bogus name, leaving a stray directory behind. Passing a real
   * name isn't enough on its own either: even though the download
   * template's own `--list` prints the index and exits before doing any
   * actual creation work (confirmed: nothing appears on disk under a
   * throwaway `-P` - see below), there's still a window, while `lxc-create`
   * is running, where `lxc-ls`/`lxc-info` against that path can see a
   * half-registered container - observed directly: a concurrent
   * `listContainers()` poll caught `__nonraid_lxc_distro_probe` mid-flight
   * as a real (if stopped) entry in the container list for over a second.
   * Pointing `-P` at an isolated scratch directory instead of the real
   * `lxcDefaultPath` sidesteps that race entirely, rather than papering
   * over the symptom with a name-based filter on every list-facing method.
   *
   * Not routed through a hardcoded template script path (e.g.
   * `/usr/share/lxc/templates/lxc-download`, which is Debian/Ubuntu-
   * specific) - going through `lxc-create` resolves the template the same
   * way an actual create would.
   *
   * Only entries for `DEFAULT_ARCH` with the "default" variant are kept -
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
   * stdout/stderr as progress lines - the download template's own output is
   * plain text with no byte-level progress protocol (unlike Docker's
   * registry pulls), so there is no percentage to compute, only a message
   * per line. Uses `spawn` rather than `execFile` specifically so output can
   * be streamed as it arrives instead of buffered until exit.
   */
  private runCreateTemplate(args: string[], onProgress?: CreateLxcProgressCallback): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('lxc-create', args, { stdio: ['ignore', 'pipe', 'pipe'] });

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
      message: `Downloading ${options.distribution} ${options.release} (${options.arch}) - this can take a while`,
      percent: null,
    });

    await this.runCreateTemplate(
      [
        '-P',
        config.lxcDefaultPath,
        '--name',
        options.name,
        // overlayfs, not dir: gives real copy-on-write snapshots (see listSnapshots() etc. below)
        // regardless of the underlying filesystem (XFS array disk or Btrfs cache pool) - a plain
        // dir-backed container's "snapshot" is a full rsync copy of the whole rootfs every time,
        // confirmed live to still nominally work but is neither fast nor space-efficient.
        '--bdev=overlayfs',
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
    // 'bridge' (default): a veth pair, one end on the container, the other attached to a host
    // bridge - the container gets an IP on whatever subnet that bridge serves. 'macvlan': the
    // container's virtual interface rides directly on a physical NIC (lxc.net.0.link becomes that
    // NIC's name, e.g. eno0) with mode=bridge, so the container's own DHCP/ARP traffic reaches the
    // real LAN directly and it gets a real LAN IP - indistinguishable from a separate physical
    // device, except the host itself can't reach the container over this interface (a macvlan
    // kernel limitation: container-to-LAN and container-to-container both work, host-to-container
    // doesn't).
    const netEntries: [key: string, value: string | null][] =
      options.networkType === 'macvlan'
        ? [
            ['lxc.net.0.type', 'macvlan'],
            ['lxc.net.0.macvlan.mode', 'bridge'],
            ['lxc.net.0.link', options.bridge],
          ]
        : [
            ['lxc.net.0.type', 'veth'],
            ['lxc.net.0.link', options.bridge],
          ];
    await setVariables(configPath, [
      ...netEntries,
      ['lxc.net.0.flags', 'up'],
      ['lxc.net.0.hwaddr', randomLocallyAdministeredMac()],
      [AUTOSTART_KEY, options.autostart ? '1' : '0'],
      [DESCRIPTION_KEY, options.description.trim() || null],
      [WEBUI_KEY, options.webUiUrl.trim() || null],
      [DISTRIBUTION_KEY, options.distribution.trim() || null],
    ]);

    onProgress?.({ phase: 'starting', message: 'Starting container', percent: null });
    await this.startContainer(options.name);
    return { ok: true, message: `Container "${options.name}" created and started` };
  }
}
