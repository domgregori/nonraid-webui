import type {
  CreateLxcContainerOptions,
  CreateLxcProgressCallback,
  LxcCommandResult,
  LxcContainerDetail,
  LxcContainerSummary,
  LxcDistroOption,
} from './types.js';

export interface LxcClient {
  listContainers(): Promise<LxcContainerSummary[]>;
  inspectContainer(name: string): Promise<LxcContainerDetail>;
  startContainer(name: string): Promise<LxcCommandResult>;
  stopContainer(name: string, options?: { force?: boolean }): Promise<LxcCommandResult>;
  restartContainer(name: string): Promise<LxcCommandResult>;
  destroyContainer(name: string): Promise<LxcCommandResult>;
  createContainer(options: CreateLxcContainerOptions, onProgress?: CreateLxcProgressCallback): Promise<LxcCommandResult>;
  // Raw read/write of the container's actual on-disk `config` file — backs
  // the LXC page's "Edit" dialog. Editing the real file directly (rather
  // than a curated subset of fields) fits LXC better than Docker's
  // create/recreate model: an LXC container isn't immutable, so its config
  // can just be edited in place.
  getConfigText(name: string): Promise<string>;
  setConfigText(name: string, content: string): Promise<LxcCommandResult>;
  // Host bridge/veth-parent interfaces a new container's network can attach
  // to — see the "Networking note" in the LXC handoff.
  listBridges(): Promise<string[]>;
  // Physical NICs (e.g. eno0) a new container's network can ride directly on via macvlan, getting
  // its own DHCP-assigned LAN IP instead of going through a host bridge.
  listPhysicalInterfaces(): Promise<string[]>;
  // Distribution/release combos the create form can offer — fetched live
  // from the image server via the download template's own `--list`.
  listDistros(): Promise<{ distros: LxcDistroOption[]; defaultArch: string }>;
}
