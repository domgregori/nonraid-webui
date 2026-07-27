import Docker from 'dockerode';
import type { DockerClient } from './client.js';
import type { ContainerRuntimeState, DockerCommandResult, DockerContainerSummary } from './types.js';

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
}
