import { HttpError } from '../httpError.js';
import type { NmdClient } from '../nmd/index.js';
import type { ApplyContext, ShareApplier } from './applier/client.js';
import type { ShareStore } from './store.js';
import type { Share, ShareWithStats } from './types.js';
import { validateShareInput } from './validate.js';

export class ShareService {
  constructor(
    private store: ShareStore,
    private applier: ShareApplier,
    private nmd: NmdClient,
  ) {}

  private async buildContext(): Promise<ApplyContext> {
    const status = await this.nmd.getStatus();
    const diskMountpoints: Record<number, string> = {};
    const diskSizesGb: Record<number, number> = {};

    for (const d of status.disks) {
      if (d.type !== 'data') continue;
      diskSizesGb[d.slot] = d.size_gb;
      const mp = d.filesystem?.mountpoint;
      if (mp && mp !== '-') diskMountpoints[d.slot] = mp;
    }

    return { diskMountpoints, diskSizesGb };
  }

  async list(): Promise<ShareWithStats[]> {
    const [shares, ctx] = await Promise.all([this.store.list(), this.buildContext()]);
    return Promise.all(shares.map(async (s) => ({ ...s, stats: await this.applier.getStats(s, ctx) })));
  }

  async create(input: unknown): Promise<Share> {
    const share = validateShareInput(input);
    if (await this.store.get(share.name)) {
      throw new HttpError(409, `Share "${share.name}" already exists.`);
    }

    const ctx = await this.buildContext();
    await this.applier.mountShare(share, ctx);
    await this.store.upsert(share);
    await this.applier.syncExports(await this.store.list());
    return share;
  }

  async update(name: string, input: unknown): Promise<Share> {
    if (!(await this.store.get(name))) {
      throw new HttpError(404, `Share "${name}" not found.`);
    }
    const share = validateShareInput(input);
    const ctx = await this.buildContext();

    if (share.name !== name) {
      if (await this.store.get(share.name)) {
        throw new HttpError(409, `Share "${share.name}" already exists.`);
      }
      await this.applier.unmountShare(name);
      await this.store.remove(name);
    }

    await this.applier.mountShare(share, ctx);
    await this.store.upsert(share);
    await this.applier.syncExports(await this.store.list());
    return share;
  }

  async remove(name: string): Promise<void> {
    if (!(await this.store.get(name))) {
      throw new HttpError(404, `Share "${name}" not found.`);
    }
    await this.applier.unmountShare(name);
    await this.store.remove(name);
    await this.applier.syncExports(await this.store.list());
  }
}
