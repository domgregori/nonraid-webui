import type { LxcClient } from './client.js';
import { parseVariable } from './configFile.js';
import { DEFAULT_ARCH, FALLBACK_DISTROS } from './distros.js';
import type {
  CreateLxcContainerOptions,
  CreateLxcProgressCallback,
  LxcCommandResult,
  LxcContainerDetail,
  LxcContainerSummary,
  LxcDistroOption,
  LxcRuntimeState,
} from './types.js';

const DESCRIPTION_KEY = '#container_description';
const WEBUI_KEY = '#container_webui';
const AUTOSTART_KEY = 'lxc.start.auto';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface MockContainer {
  name: string;
  autostart: boolean;
  description: string | null;
  webUiUrl: string | null;
  pid: number;
  rootfsPath: string;
  bridge: string;
  macAddress: string;
  cpuLimit: string | null;
  memLimitBytes: number | null;
  cpuPercent: number;
  memUsedBytes: number;
  ips: string[];
  // Synthesized, editable "on-disk" config text — the mock equivalent of
  // the real container's config file, so the LXC page's "Edit config"
  // dialog has something real to load/save against in mock mode too.
  configText: string;
}

function synthesizeConfigText(c: {
  name: string;
  rootfsPath: string;
  bridge: string;
  macAddress: string;
  autostart: boolean;
  description: string | null;
  webUiUrl: string | null;
}): string {
  const lines = [
    `lxc.uts.name = ${c.name}`,
    `lxc.rootfs.path = dir:${c.rootfsPath}`,
    `lxc.net.0.type = veth`,
    `lxc.net.0.link = ${c.bridge}`,
    `lxc.net.0.flags = up`,
    `lxc.net.0.hwaddr = ${c.macAddress}`,
    `${AUTOSTART_KEY} = ${c.autostart ? '1' : '0'}`,
  ];
  if (c.description) lines.push(`${DESCRIPTION_KEY} = ${c.description}`);
  if (c.webUiUrl) lines.push(`${WEBUI_KEY} = ${c.webUiUrl}`);
  return `${lines.join('\n')}\n`;
}

const SEEDS: MockContainer[] = (
  [
    {
      name: 'debian-build',
      autostart: true,
      description: 'Debian 12 build box',
      webUiUrl: null,
      pid: 4821,
      rootfsPath: '/var/lib/lxc/debian-build/rootfs',
      bridge: 'br0',
      macAddress: '52:54:00:aa:bb:01',
      cpuLimit: null,
      memLimitBytes: null,
      cpuPercent: 4,
      memUsedBytes: 210 * 1024 * 1024,
      ips: ['192.168.1.51'],
    },
    {
      name: 'alpine-tools',
      autostart: false,
      description: 'Scratch Alpine container for one-off tools',
      webUiUrl: null,
      pid: 0,
      rootfsPath: '/var/lib/lxc/alpine-tools/rootfs',
      bridge: 'br0',
      macAddress: '52:54:00:aa:bb:02',
      cpuLimit: null,
      memLimitBytes: null,
      cpuPercent: 0,
      memUsedBytes: 0,
      ips: [],
    },
  ] satisfies Omit<MockContainer, 'configText'>[]
).map((c) => ({ ...c, configText: synthesizeConfigText(c) }));

const INITIAL_STATE: Record<string, LxcRuntimeState> = {
  'debian-build': 'running',
  'alpine-tools': 'stopped',
};

export class MockLxcClient implements LxcClient {
  readonly mode = 'mock' as const;
  private state: Record<string, LxcRuntimeState> = { ...INITIAL_STATE };
  private containers: MockContainer[] = SEEDS.map((s) => ({ ...s, ips: [...s.ips] }));

  private find(name: string): MockContainer {
    const container = this.containers.find((c) => c.name === name);
    if (!container) throw new Error(`No such container: ${name}`);
    return container;
  }

  async listContainers(): Promise<LxcContainerSummary[]> {
    return this.containers.map((c) => {
      const state = this.state[c.name] ?? 'stopped';
      const running = state === 'running';
      return {
        name: c.name,
        state,
        autostart: c.autostart,
        description: c.description,
        webUiUrl: c.webUiUrl,
        cpuPercent: running ? c.cpuPercent : null,
        memUsedBytes: running ? c.memUsedBytes : null,
        memLimitBytes: c.memLimitBytes,
        ips: running ? c.ips : [],
      };
    });
  }

  async inspectContainer(name: string): Promise<LxcContainerDetail> {
    const c = this.find(name);
    const state = this.state[name] ?? 'stopped';
    return {
      name: c.name,
      state,
      autostart: c.autostart,
      description: c.description,
      webUiUrl: c.webUiUrl,
      pid: state === 'running' ? c.pid : null,
      rootfsPath: c.rootfsPath,
      bridge: c.bridge,
      macAddress: c.macAddress,
      cpuLimit: c.cpuLimit,
      memLimitBytes: c.memLimitBytes,
    };
  }

  async startContainer(name: string): Promise<LxcCommandResult> {
    this.find(name);
    this.state[name] = 'running';
    return { ok: true, message: `Container "${name}" started (mock)` };
  }

  async stopContainer(name: string): Promise<LxcCommandResult> {
    this.find(name);
    this.state[name] = 'stopped';
    return { ok: true, message: `Container "${name}" stopped (mock)` };
  }

  async restartContainer(name: string): Promise<LxcCommandResult> {
    this.find(name);
    this.state[name] = 'running';
    return { ok: true, message: `Container "${name}" restarted (mock)` };
  }

  async destroyContainer(name: string): Promise<LxcCommandResult> {
    const idx = this.containers.findIndex((c) => c.name === name);
    if (idx === -1) throw new Error(`No such container: ${name}`);
    this.containers.splice(idx, 1);
    delete this.state[name];
    return { ok: true, message: `Container "${name}" destroyed (mock)` };
  }

  async getConfigText(name: string): Promise<string> {
    return this.find(name).configText;
  }

  async setConfigText(name: string, content: string): Promise<LxcCommandResult> {
    const c = this.find(name);
    c.configText = content;
    // Keep the summary/detail views in sync with whatever the user just
    // saved, same as the real client re-reading these lines from disk.
    c.autostart = parseVariable(content, AUTOSTART_KEY) === '1';
    c.description = parseVariable(content, DESCRIPTION_KEY);
    c.webUiUrl = parseVariable(content, WEBUI_KEY);
    return { ok: true, message: `Container "${name}" config saved (mock)` };
  }

  async listBridges(): Promise<string[]> {
    return ['br0', 'virbr0'];
  }

  async listDistros(): Promise<{ distros: LxcDistroOption[]; defaultArch: string }> {
    return { distros: FALLBACK_DISTROS, defaultArch: DEFAULT_ARCH };
  }

  async createContainer(options: CreateLxcContainerOptions, onProgress?: CreateLxcProgressCallback): Promise<LxcCommandResult> {
    onProgress?.({
      phase: 'creating',
      message: `Downloading ${options.distribution} ${options.release} (${options.arch}) (mock)`,
      percent: null,
    });
    await sleep(200);
    onProgress?.({ phase: 'creating', message: 'Unpacking rootfs (mock)', percent: null });
    await sleep(200);
    onProgress?.({ phase: 'configuring', message: 'Writing network and metadata configuration (mock)', percent: null });
    await sleep(150);
    onProgress?.({ phase: 'starting', message: 'Starting container (mock)', percent: null });
    await sleep(150);

    const created = {
      name: options.name,
      autostart: options.autostart,
      description: options.description.trim() || null,
      webUiUrl: options.webUiUrl.trim() || null,
      pid: 9000 + this.containers.length,
      rootfsPath: `/var/lib/lxc/${options.name}/rootfs`,
      bridge: options.bridge,
      macAddress: '52:54:00:aa:bb:ff',
      cpuLimit: null,
      memLimitBytes: null,
      cpuPercent: 0,
      memUsedBytes: 24 * 1024 * 1024,
      ips: ['192.168.1.99'],
    };
    this.containers.push({ ...created, configText: synthesizeConfigText(created) });
    this.state[options.name] = 'running';
    return { ok: true, message: `Container "${options.name}" created and started (mock)` };
  }
}
