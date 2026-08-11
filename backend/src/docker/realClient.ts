import Docker from 'dockerode';
import type { DockerClient } from './client.js';
import type {
  ContainerDetail,
  ContainerPortMapping,
  ContainerRuntimeState,
  CreateContainerOptions,
  CreateContainerProgressCallback,
  DockerCommandResult,
  DockerContainerSummary,
} from './types.js';

interface PullProgressEvent {
  status?: string;
  id?: string;
  progressDetail?: { current?: number; total?: number };
}

interface CpuStatsLike {
  cpu_usage: { total_usage: number; percpu_usage?: number[] };
  system_cpu_usage?: number;
  online_cpus?: number;
}

interface MemStatsLike {
  usage: number;
  limit: number;
  stats?: { cache?: number; inactive_file?: number };
}

function computeCpuPercent(cpuStats: CpuStatsLike, precpuStats: CpuStatsLike): number {
  const cpuDelta = cpuStats.cpu_usage.total_usage - precpuStats.cpu_usage.total_usage;
  const systemDelta = (cpuStats.system_cpu_usage ?? 0) - (precpuStats.system_cpu_usage ?? 0);
  const onlineCpus = cpuStats.online_cpus ?? cpuStats.cpu_usage.percpu_usage?.length ?? 1;
  if (systemDelta <= 0 || cpuDelta <= 0) return 0;
  return (cpuDelta / systemDelta) * onlineCpus * 100;
}

function computeMemUsed(memStats: MemStatsLike): number {
  const cache = memStats.stats?.cache ?? memStats.stats?.inactive_file ?? 0;
  return Math.max(0, memStats.usage - cache);
}

interface DockerPortBindings {
  [portAndProtocol: string]: { HostPort?: string }[] | null;
}

interface DockerDevice {
  PathOnHost: string;
  PathInContainer: string;
}

/** Parses "host:container" or "host:container:ro" — the exact format Binds
 * is written in by createContainer, so this is a lossless round-trip. */
function parseBind(bind: string): { hostPath: string; containerPath: string; readOnly: boolean } {
  const parts = bind.split(':');
  const readOnly = parts.at(-1) === 'ro';
  if (readOnly) parts.pop();
  const [hostPath, containerPath] = parts;
  return { hostPath: hostPath ?? '', containerPath: containerPath ?? '', readOnly };
}

function parsePortBindings(bindings: DockerPortBindings | undefined): { containerPort: number; hostPort: number; protocol: 'tcp' | 'udp' }[] {
  if (!bindings) return [];
  const result: { containerPort: number; hostPort: number; protocol: 'tcp' | 'udp' }[] = [];
  for (const [key, hostEntries] of Object.entries(bindings)) {
    const [portStr, protocol] = key.split('/');
    const containerPort = Number(portStr);
    for (const entry of hostEntries ?? []) {
      const hostPort = Number(entry.HostPort);
      if (Number.isInteger(containerPort) && Number.isInteger(hostPort)) {
        result.push({ containerPort, hostPort, protocol: protocol === 'udp' ? 'udp' : 'tcp' });
      }
    }
  }
  return result;
}

/**
 * A container without a TTY (the default, and what our own createContainer
 * always produces) has its stdout/stderr multiplexed into one stream: each
 * frame is an 8-byte header — [stream type, 0, 0, 0, size as big-endian
 * uint32] — followed by that many bytes of payload. A TTY container's logs
 * are raw text with no framing at all. `container.logs()` doesn't tell you
 * which you got, so the caller has to check `Tty` from inspect first.
 */
function demuxLogBuffer(buffer: Buffer): string {
  const chunks: string[] = [];
  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const size = buffer.readUInt32BE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > buffer.length) break;
    chunks.push(buffer.subarray(start, end).toString('utf8'));
    offset = end;
  }
  return chunks.join('');
}

function formatPorts(ports: Docker.Port[]): string {
  if (!ports || ports.length === 0) return '—';
  const seen = new Set<string>();
  for (const p of ports) {
    seen.add(p.PublicPort ? `${p.PublicPort}:${p.PrivatePort}` : `${p.PrivatePort}/${p.Type}`);
  }
  return [...seen].join(', ');
}

function toPortMappings(ports: Docker.Port[]): ContainerPortMapping[] {
  if (!ports) return [];
  return ports
    .filter((p) => p.PublicPort)
    .map((p) => ({ containerPort: p.PrivatePort, hostPort: p.PublicPort, protocol: p.Type === 'udp' ? 'udp' : 'tcp' }) as ContainerPortMapping);
}

/** dockerode's own error for a missing/unreachable daemon is just the raw Node
 *  socket-connect failure (e.g. "connect ENOENT /var/run/docker.sock") — accurate
 *  but not exactly self-explanatory to someone reading it on a dashboard. */
function isDockerUnreachable(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ECONNREFUSED' || code === 'EACCES';
}

export class RealDockerClient implements DockerClient {
  private docker = new Docker();

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (isDockerUnreachable(err)) {
        throw new Error('Could not reach the Docker daemon (checked /var/run/docker.sock) — is Docker installed and running on this host?');
      }
      throw err;
    }
  }

  async listContainers(): Promise<DockerContainerSummary[]> {
    return this.guard(() => this.listContainersInner());
  }

  private async listContainersInner(): Promise<DockerContainerSummary[]> {
    const containers = await this.docker.listContainers({ all: true });

    return Promise.all(
      containers.map(async (c): Promise<DockerContainerSummary> => {
        const state: ContainerRuntimeState = c.State === 'running' ? 'running' : 'stopped';
        const name = (c.Names[0] ?? c.Id).replace(/^\//, '');

        let cpuPercent: number | null = null;
        let memUsedBytes: number | null = null;
        let memLimitBytes: number | null = null;

        if (state === 'running') {
          try {
            const stats = await this.docker.getContainer(c.Id).stats({ stream: false });
            cpuPercent = computeCpuPercent(stats.cpu_stats, stats.precpu_stats);
            memUsedBytes = computeMemUsed(stats.memory_stats);
            memLimitBytes = stats.memory_stats.limit;
          } catch {
            // container may have stopped between list and stats calls — leave stats null
          }
        }

        return {
          id: c.Id,
          name,
          image: c.Image,
          state,
          status: c.Status,
          cpuPercent,
          memUsedBytes,
          memLimitBytes,
          ports: formatPorts(c.Ports),
          portMappings: toPortMappings(c.Ports),
          labels: c.Labels ?? {},
          webUiUrl: null,
          icon: c.Labels?.['net.unraid.docker.icon'] ?? null,
        };
      }),
    );
  }

  async inspectContainer(id: string): Promise<ContainerDetail> {
    return this.guard(() => this.inspectContainerInner(id));
  }

  private async inspectContainerInner(id: string): Promise<ContainerDetail> {
    const info = await this.docker.getContainer(id).inspect();
    const env = (info.Config.Env ?? []).map((entry) => {
      const eq = entry.indexOf('=');
      return eq === -1 ? { name: entry, value: '' } : { name: entry.slice(0, eq), value: entry.slice(eq + 1) };
    });
    const binds = (info.HostConfig.Binds ?? []).map(parseBind);
    const devices = ((info.HostConfig.Devices as DockerDevice[] | undefined) ?? []).map((d) => ({
      hostPath: d.PathOnHost,
      containerPath: d.PathInContainer,
    }));

    return {
      id: info.Id,
      name: info.Name.replace(/^\//, ''),
      image: info.Config.Image, // the reference actually used to create it (e.g. "repo:tag") — Id/top-level Image is a resolved sha256 digest, not editable
      network: info.HostConfig.NetworkMode ?? 'bridge',
      privileged: info.HostConfig.Privileged ?? false,
      env,
      ports: parsePortBindings(info.HostConfig.PortBindings as DockerPortBindings | undefined),
      binds,
      devices,
      labels: info.Config.Labels ?? {},
    };
  }

  async startContainer(id: string): Promise<DockerCommandResult> {
    return this.guard(async () => {
      await this.docker.getContainer(id).start();
      return { ok: true, message: 'Container started' };
    });
  }

  async stopContainer(id: string): Promise<DockerCommandResult> {
    return this.guard(async () => {
      await this.docker.getContainer(id).stop();
      return { ok: true, message: 'Container stopped' };
    });
  }

  async restartContainer(id: string): Promise<DockerCommandResult> {
    return this.guard(async () => {
      await this.docker.getContainer(id).restart();
      return { ok: true, message: 'Container restarted' };
    });
  }

  async removeContainer(id: string, options?: { force?: boolean }): Promise<DockerCommandResult> {
    return this.guard(async () => {
      await this.docker.getContainer(id).remove({ force: options?.force ?? false });
      return { ok: true, message: 'Container removed' };
    });
  }

  async destroyContainer(id: string): Promise<DockerCommandResult> {
    return this.guard(async () => {
      const container = this.docker.getContainer(id);
      const info = await container.inspect();
      const imageRef = info.Config.Image; // e.g. "repo:tag" — the reference actually used to create it
      await container.remove({ force: true });
      try {
        await this.docker.getImage(imageRef).remove({ force: false });
        return { ok: true, message: `Container removed, image "${imageRef}" removed` };
      } catch {
        // Still referenced by another container (running or stopped) — not an error, just means
        // this wasn't the last container using it.
        return { ok: true, message: `Container removed (image "${imageRef}" kept — still used by another container)` };
      }
    });
  }

  async getContainerLogs(id: string, tail = 500): Promise<string> {
    return this.guard(async () => {
      const container = this.docker.getContainer(id);
      const info = await container.inspect();
      const buffer = (await container.logs({ stdout: true, stderr: true, tail, timestamps: true, follow: false })) as unknown as Buffer;
      return info.Config.Tty ? buffer.toString('utf8') : demuxLogBuffer(buffer);
    });
  }

  async getDataRoot(): Promise<string> {
    return this.guard(async () => {
      const info = (await this.docker.info()) as { DockerRootDir: string };
      return info.DockerRootDir;
    });
  }

  async pruneImages(): Promise<{ imagesDeleted: number; spaceReclaimedBytes: number }> {
    return this.guard(async () => {
      // dangling: ['false'] widens this from Docker's own default (untagged/dangling images only)
      // to every image not referenced by any container — the case an admin actually means by
      // "prune images" (e.g. a leftover tagged image from a container that was since destroyed).
      const result = await this.docker.pruneImages({ filters: { dangling: ['false'] } });
      return {
        imagesDeleted: (result.ImagesDeleted ?? []).length,
        spaceReclaimedBytes: result.SpaceReclaimed ?? 0,
      };
    });
  }

  /** dockerode's createContainer, unlike the `docker` CLI, does not pull a missing
   * image on its own — it fails outright with a 404 if the image isn't already
   * cached locally, which is the common case for a template being installed for
   * the first time. */
  private async ensureImagePulled(image: string, onProgress?: CreateContainerProgressCallback): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
      return;
    } catch {
      // not present locally — pull it below
    }

    onProgress?.({ phase: 'pulling', message: `Pulling ${image}`, percent: 0 });

    // Each image layer ("id") reports its own current/total bytes independently
    // and in parallel — sum across all layers seen so far for one overall
    // percentage rather than showing a per-layer breakdown.
    const layerBytes = new Map<string, { current: number; total: number }>();
    const aggregatePercent = (): number | null => {
      let current = 0;
      let total = 0;
      for (const layer of layerBytes.values()) {
        current += layer.current;
        total += layer.total;
      }
      return total > 0 ? Math.min(100, Math.round((current / total) * 100)) : null;
    };

    await new Promise<void>((resolve, reject) => {
      this.docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) return reject(err);
        this.docker.modem.followProgress(
          stream,
          (err2: Error | null) => (err2 ? reject(err2) : resolve()),
          (event: PullProgressEvent) => {
            if (event.id && event.progressDetail?.total) {
              layerBytes.set(event.id, {
                current: event.progressDetail.current ?? 0,
                total: event.progressDetail.total,
              });
            }
            onProgress?.({
              phase: 'pulling',
              message: event.status ?? `Pulling ${image}`,
              percent: aggregatePercent(),
              layerId: event.id,
              layerStatus: event.status,
            });
          },
        );
      });
    });
  }

  async createContainer(options: CreateContainerOptions, onProgress?: CreateContainerProgressCallback): Promise<DockerCommandResult> {
    return this.guard(() => this.createContainerInner(options, onProgress));
  }

  private async createContainerInner(options: CreateContainerOptions, onProgress?: CreateContainerProgressCallback): Promise<DockerCommandResult> {
    await this.ensureImagePulled(options.image, onProgress);
    onProgress?.({ phase: 'creating', message: 'Creating container', percent: null });

    const exposedPorts: Record<string, object> = {};
    const portBindings: Record<string, { HostPort: string }[]> = {};
    for (const p of options.ports) {
      const key = `${p.containerPort}/${p.protocol}`;
      exposedPorts[key] = {};
      portBindings[key] = [{ HostPort: String(p.hostPort) }];
    }

    const container = await this.docker.createContainer({
      name: options.name,
      Image: options.image,
      Env: options.env,
      Labels: options.labels,
      ExposedPorts: exposedPorts,
      HostConfig: {
        PortBindings: portBindings,
        Binds: options.binds,
        Devices: options.devices.map((d) => ({
          PathOnHost: d.hostPath,
          PathInContainer: d.containerPath,
          CgroupPermissions: 'rwm',
        })),
        NetworkMode: options.network,
        Privileged: options.privileged,
      },
    });
    onProgress?.({ phase: 'starting', message: 'Starting container', percent: null });
    try {
      await container.start();
    } catch (err) {
      // dockerode's create() can succeed (e.g. a bad NetworkMode isn't checked until start)
      // and leave a container object registered but never running — confirmed live with a
      // nonexistent network name, where retrying Start failed identically forever since the
      // bad config is baked in at create time. Remove it so the name is free again and the
      // failure doesn't linger as an unusable, unlabeled "Created" container.
      await container.remove({ force: true }).catch(() => {});
      throw err;
    }
    return { ok: true, message: `Container "${options.name}" created and started` };
  }
}
