import type { ApplyContext, ShareApplier } from '../shares/applier/client.js';
import type { Share, ShareCommandResult, ShareStats } from '../shares/types.js';

const defaults = {
  mountShare: async (share: Share, _ctx: ApplyContext): Promise<ShareCommandResult> => ({
    ok: true,
    message: `Mounted "${share.name}"`,
  }),
  unmountShare: async (name: string): Promise<ShareCommandResult> => ({ ok: true, message: `Unmounted "${name}"` }),
  syncExports: async (allShares: Share[], _accessByShare: Record<string, unknown>): Promise<ShareCommandResult> => ({
    ok: true,
    message: `Synced ${allShares.length} share export(s)`,
  }),
  getStats: async (_share: Share, _ctx: ApplyContext): Promise<ShareStats> => ({ usedBytes: 1_000_000_000, totalBytes: 4_000_000_000_000 }),
  getActiveConnectionCounts: async (): Promise<Record<string, number>> => ({}),
} satisfies ShareApplier;

/** Builds an in-memory ShareApplier fake; pass overrides to customize one method per test. */
export function createFakeShareApplier(overrides: Partial<ShareApplier> = {}): ShareApplier {
  return { ...defaults, ...overrides };
}
