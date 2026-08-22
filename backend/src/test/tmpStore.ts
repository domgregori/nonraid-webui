import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ActivityStore } from '../activity/store.js';
import { SettingsStore } from '../settings/store.js';
import { ShareAccessStore } from '../shares/aclStore.js';
import { ShareStore } from '../shares/store.js';

/**
 * Builds every JSON-file store against one per-test temp directory
 * (fs.mkdtempSync). Call cleanup() in afterEach to remove the directory.
 * Each store takes an explicit filePath, bypassing the config defaults.
 */
export interface TmpStores {
  dir: string;
  shareStore: ShareStore;
  aclStore: ShareAccessStore;
  settingsStore: SettingsStore;
  activityStore: ActivityStore;
  cleanup: () => void;
}

export function tmpStore(): TmpStores {
  const dir = mkdtempSync(path.join(tmpdir(), 'nonraid-test-'));
  return {
    dir,
    shareStore: new ShareStore(path.join(dir, 'shares.json')),
    aclStore: new ShareAccessStore(path.join(dir, 'share-access.json')),
    settingsStore: new SettingsStore(path.join(dir, 'settings.json')),
    activityStore: new ActivityStore(path.join(dir, 'activity.json')),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
