import type { DockerClient } from './client.js';
import type {
  ContainerRuntimeState,
  CreateContainerOptions,
  CreateContainerProgressCallback,
  DockerCommandResult,
  DockerContainerSummary,
} from './types.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface MockContainerSeed {
  id: string;
  name: string;
  image: string;
  ports: string;
  cpuPercent: number;
  memUsedBytes: number;
  memLimitBytes: number;
  labels?: Record<string, string>;
}

const SEEDS: MockContainerSeed[] = [
  { id: 'mock-jellyfin', name: 'jellyfin', image: 'jellyfin/jellyfin:10.9', ports: '8096:8096', cpuPercent: 6, memUsedBytes: 420 * 1024 * 1024, memLimitBytes: 8 * 1024 * 1024 * 1024 },
  { id: 'mock-nextcloud', name: 'nextcloud', image: 'nextcloud:29', ports: '443:443', cpuPercent: 3, memUsedBytes: 310 * 1024 * 1024, memLimitBytes: 8 * 1024 * 1024 * 1024 },
  { id: 'mock-mergerfs-mover', name: 'mergerfs-mover', image: 'monstermuffin/mergerfs-cache-mover', ports: '—', cpuPercent: 0, memUsedBytes: 0, memLimitBytes: 8 * 1024 * 1024 * 1024 },
  { id: 'mock-qbittorrent', name: 'qbittorrent', image: 'linuxserver/qbittorrent', ports: '8080:8080', cpuPercent: 11, memUsedBytes: 180 * 1024 * 1024, memLimitBytes: 8 * 1024 * 1024 * 1024 },
];

const INITIAL_STATE: Record<string, ContainerRuntimeState> = {
  'mock-jellyfin': 'running',
  'mock-nextcloud': 'running',
  'mock-mergerfs-mover': 'stopped',
  'mock-qbittorrent': 'running',
};

export class MockDockerClient implements DockerClient {
  readonly mode = 'mock' as const;
  private state: Record<string, ContainerRuntimeState> = { ...INITIAL_STATE };
  private installed: MockContainerSeed[] = [];

  private find(id: string): MockContainerSeed {
    const seed = [...SEEDS, ...this.installed].find((s) => s.id === id);
    if (!seed) throw new Error(`No such container: ${id}`);
    return seed;
  }

  async listContainers(): Promise<DockerContainerSummary[]> {
    return [...SEEDS, ...this.installed].map((seed) => {
      const state: ContainerRuntimeState = this.state[seed.id] ?? 'stopped';
      const running = state === 'running';
      return {
        id: seed.id,
        name: seed.name,
        image: seed.image,
        state,
        status: running ? 'Up (mock)' : 'Exited (mock)',
        cpuPercent: running ? seed.cpuPercent : null,
        memUsedBytes: running ? seed.memUsedBytes : null,
        memLimitBytes: running ? seed.memLimitBytes : null,
        ports: running ? seed.ports : '—',
        labels: seed.labels ?? {},
      };
    });
  }

  async startContainer(id: string): Promise<DockerCommandResult> {
    this.find(id);
    this.state[id] = 'running';
    return { ok: true, message: 'Container started' };
  }

  async stopContainer(id: string): Promise<DockerCommandResult> {
    this.find(id);
    this.state[id] = 'stopped';
    return { ok: true, message: 'Container stopped' };
  }

  async restartContainer(id: string): Promise<DockerCommandResult> {
    this.find(id);
    this.state[id] = 'running';
    return { ok: true, message: 'Container restarted' };
  }

  async createContainer(options: CreateContainerOptions, onProgress?: CreateContainerProgressCallback): Promise<DockerCommandResult> {
    // Simulated pacing so the progress UI has something real to exercise
    // without a real Docker daemon — not meant to model actual pull speed.
    const mockLayers = ['a1b2c3d4e5f6', 'b2c3d4e5f6a7', 'c3d4e5f6a7b8'];
    for (const id of mockLayers) {
      onProgress?.({ phase: 'pulling', message: `Pulling ${options.image} (mock)`, percent: 0, layerId: id, layerStatus: 'Pulling fs layer' });
    }
    await sleep(150);
    for (const percent of [25, 55, 85, 100]) {
      for (const id of mockLayers) {
        onProgress?.({
          phase: 'pulling',
          message: `Pulling ${options.image} (mock)`,
          percent,
          layerId: id,
          layerStatus: percent < 100 ? 'Downloading' : 'Pull complete',
        });
      }
      await sleep(200);
    }
    onProgress?.({ phase: 'creating', message: 'Creating container (mock)', percent: null });
    await sleep(150);
    onProgress?.({ phase: 'starting', message: 'Starting container (mock)', percent: null });
    await sleep(150);

    const id = `mock-installed-${options.name}`;
    this.installed.push({
      id,
      name: options.name,
      image: options.image,
      ports: options.ports.map((p) => `${p.hostPort}:${p.containerPort}`).join(', ') || '—',
      cpuPercent: 0,
      memUsedBytes: 32 * 1024 * 1024,
      memLimitBytes: 8 * 1024 * 1024 * 1024,
      labels: options.labels,
    });
    this.state[id] = 'running';
    return { ok: true, message: `Container "${options.name}" created and started (mock)` };
  }
}
