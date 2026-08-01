import type { DockerClient } from './client.js';
import type {
  ContainerDetail,
  ContainerDeviceMapping,
  ContainerEnvVar,
  ContainerPortMapping,
  ContainerRuntimeState,
  ContainerVolumeMount,
  CreateContainerOptions,
  CreateContainerProgressCallback,
  DockerCommandResult,
  DockerContainerSummary,
} from './types.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface MockContainer {
  id: string;
  name: string;
  image: string;
  ports: string; // formatted for the list view, e.g. "8096:8096"
  cpuPercent: number;
  memUsedBytes: number;
  memLimitBytes: number;
  labels: Record<string, string>;
  // Full detail for inspect/edit — undefined on the hardcoded seeds below
  // (they're display-only fixtures, never created through this client), so
  // inspecting one synthesizes a minimal detail instead.
  detail?: {
    network: string;
    privileged: boolean;
    env: ContainerEnvVar[];
    ports: ContainerPortMapping[];
    binds: ContainerVolumeMount[];
    devices: ContainerDeviceMapping[];
  };
}

const SEEDS: MockContainer[] = [
  { id: 'mock-jellyfin', name: 'jellyfin', image: 'jellyfin/jellyfin:10.9', ports: '8096:8096', cpuPercent: 6, memUsedBytes: 420 * 1024 * 1024, memLimitBytes: 8 * 1024 * 1024 * 1024, labels: {} },
  { id: 'mock-nextcloud', name: 'nextcloud', image: 'nextcloud:29', ports: '443:443', cpuPercent: 3, memUsedBytes: 310 * 1024 * 1024, memLimitBytes: 8 * 1024 * 1024 * 1024, labels: {} },
  { id: 'mock-mergerfs-mover', name: 'mergerfs-mover', image: 'monstermuffin/mergerfs-cache-mover', ports: '—', cpuPercent: 0, memUsedBytes: 0, memLimitBytes: 8 * 1024 * 1024 * 1024, labels: {} },
  { id: 'mock-qbittorrent', name: 'qbittorrent', image: 'linuxserver/qbittorrent', ports: '8080:8080', cpuPercent: 11, memUsedBytes: 180 * 1024 * 1024, memLimitBytes: 8 * 1024 * 1024 * 1024, labels: {} },
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
  private containers: MockContainer[] = SEEDS.map((s) => ({ ...s, labels: { ...s.labels } }));

  private find(id: string): MockContainer {
    const container = this.containers.find((c) => c.id === id);
    if (!container) throw new Error(`No such container: ${id}`);
    return container;
  }

  async listContainers(): Promise<DockerContainerSummary[]> {
    return this.containers.map((container) => {
      const state: ContainerRuntimeState = this.state[container.id] ?? 'stopped';
      const running = state === 'running';
      return {
        id: container.id,
        name: container.name,
        image: container.image,
        state,
        status: running ? 'Up (mock)' : 'Exited (mock)',
        cpuPercent: running ? container.cpuPercent : null,
        memUsedBytes: running ? container.memUsedBytes : null,
        memLimitBytes: running ? container.memLimitBytes : null,
        ports: running ? container.ports : '—',
        labels: container.labels,
      };
    });
  }

  async inspectContainer(id: string): Promise<ContainerDetail> {
    const container = this.find(id);
    const d = container.detail;
    return {
      id: container.id,
      name: container.name,
      image: container.image,
      network: d?.network ?? 'bridge',
      privileged: d?.privileged ?? false,
      env: d?.env ?? [],
      ports: d?.ports ?? [],
      binds: d?.binds ?? [],
      devices: d?.devices ?? [],
      labels: container.labels,
    };
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

  async removeContainer(id: string): Promise<DockerCommandResult> {
    const idx = this.containers.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error(`No such container: ${id}`);
    this.containers.splice(idx, 1);
    delete this.state[id];
    return { ok: true, message: 'Container removed (mock)' };
  }

  async getContainerLogs(id: string, tail = 500): Promise<string> {
    const container = this.find(id);
    const running = (this.state[id] ?? 'stopped') === 'running';
    const lines = Array.from({ length: Math.min(tail, 20) }, (_, i) => {
      const ts = new Date(Date.now() - (20 - i) * 1000).toISOString();
      return `${ts} [mock] ${container.name} log line ${i + 1}`;
    });
    if (!running) lines.push(`${new Date().toISOString()} [mock] container is stopped`);
    return lines.join('\n');
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
    this.containers.push({
      id,
      name: options.name,
      image: options.image,
      ports: options.ports.map((p) => `${p.hostPort}:${p.containerPort}`).join(', ') || '—',
      cpuPercent: 0,
      memUsedBytes: 32 * 1024 * 1024,
      memLimitBytes: 8 * 1024 * 1024 * 1024,
      labels: options.labels,
      detail: {
        network: options.network,
        privileged: options.privileged,
        env: options.env.map((e) => {
          const eq = e.indexOf('=');
          return eq === -1 ? { name: e, value: '' } : { name: e.slice(0, eq), value: e.slice(eq + 1) };
        }),
        ports: options.ports,
        binds: options.binds.map((b) => {
          const parts = b.split(':');
          const readOnly = parts.at(-1) === 'ro';
          if (readOnly) parts.pop();
          return { hostPath: parts[0] ?? '', containerPath: parts[1] ?? '', readOnly };
        }),
        devices: options.devices,
      },
    });
    this.state[id] = 'running';
    return { ok: true, message: `Container "${options.name}" created and started (mock)` };
  }
}
