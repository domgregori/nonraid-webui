import type {
  CreateLxcContainerOptions,
  CreateLxcProgressCallback,
  LxcCommandResult,
  LxcContainerDetail,
  LxcContainerSummary,
  LxcDistroOption,
  LxcSnapshot,
} from './types.js';

export interface LxcClient {
  listContainers(): Promise<LxcContainerSummary[]>;
  inspectContainer(name: string): Promise<LxcContainerDetail>;
  startContainer(name: string): Promise<LxcCommandResult>;
  stopContainer(name: string, options?: { force?: boolean }): Promise<LxcCommandResult>;
  restartContainer(name: string): Promise<LxcCommandResult>;
  destroyContainer(name: string): Promise<LxcCommandResult>;
  createContainer(options: CreateLxcContainerOptions, onProgress?: CreateLxcProgressCallback): Promise<LxcCommandResult>;
  // Raw read/write of the container's actual on-disk `config` file - backs
  // the LXC page's "Edit" dialog. Editing the real file directly (rather
  // than a curated subset of fields) fits LXC better than Docker's
  // create/recreate model: an LXC container isn't immutable, so its config
  // can just be edited in place.
  getConfigText(name: string): Promise<string>;
  setConfigText(name: string, content: string): Promise<LxcCommandResult>;
  // Flips just lxc.start.auto in place - unlike setConfigText (a full raw rewrite meant for the
  // Edit dialog), this is the single-field write the card's autostart toggle uses, so a stray edit
  // elsewhere in the file can't be clobbered by a toggle click.
  setContainerAutostart(name: string, autostart: boolean): Promise<LxcCommandResult>;
  // Host bridge/veth-parent interfaces a new container's network can attach
  // to - see the "Networking note" in the LXC handoff.
  listBridges(): Promise<string[]>;
  // Physical NICs (e.g. eno0) a new container's network can ride directly on via macvlan, getting
  // its own DHCP-assigned LAN IP instead of going through a host bridge.
  listPhysicalInterfaces(): Promise<string[]>;
  // Distribution/release combos the create form can offer - fetched live
  // from the image server via the download template's own `--list`.
  listDistros(): Promise<{ distros: LxcDistroOption[]; defaultArch: string }>;
  // Snapshots - only meaningfully cheap for overlayfs-backed containers (createContainer's
  // default since this was added), but lxc-snapshot itself works against any backend.
  listSnapshots(name: string): Promise<LxcSnapshot[]>;
  createSnapshot(name: string, comment: string): Promise<LxcCommandResult>;
  // newName must always be provided and is exactly what the resulting container is named - same
  // name as the original replaces it in place (destroying current state), any other name creates
  // a new, independent container. This app's own UI treats those as two clearly distinct actions
  // rather than one field with implicit special-casing - see SnapshotsDialog.tsx.
  restoreSnapshot(name: string, snapshotName: string, newName: string): Promise<LxcCommandResult>;
  deleteSnapshot(name: string, snapshotName: string): Promise<LxcCommandResult>;
}
