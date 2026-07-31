import Docker from 'dockerode';
import type { DockerClient } from './client.js';
import type {
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

function formatPorts(ports: Docker.Port[]): string {
  if (!ports || ports.length === 0) return '—';
  const seen = new Set<string>();
  for (const p of ports) {
    seen.add(p.PublicPort ? `${p.PublicPort}:${p.PrivatePort}` : `${p.PrivatePort}/${p.Type}`);
  }
  return [...seen].join(', ');
}

export class RealDockerClient implements DockerClient {
  readonly mode = 'real' as const;
  private docker = new Docker();

  async listContainers(): Promise<DockerContainerSummary[]> {
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
          labels: c.Labels ?? {},
        };
      }),
    );
  }

  async startContainer(id: string): Promise<DockerCommandResult> {
    await this.docker.getContainer(id).start();
    return { ok: true, message: 'Container started' };
  }

  async stopContainer(id: string): Promise<DockerCommandResult> {
    await this.docker.getContainer(id).stop();
    return { ok: true, message: 'Container stopped' };
  }

  async restartContainer(id: string): Promise<DockerCommandResult> {
    await this.docker.getContainer(id).restart();
    return { ok: true, message: 'Container restarted' };
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
            onProgress?.({ phase: 'pulling', message: event.status ?? `Pulling ${image}`, percent: aggregatePercent() });
          },
        );
      });
    });
  }

  async createContainer(options: CreateContainerOptions, onProgress?: CreateContainerProgressCallback): Promise<DockerCommandResult> {
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
    await container.start();
    return { ok: true, message: `Container "${options.name}" created and started` };
  }
}
