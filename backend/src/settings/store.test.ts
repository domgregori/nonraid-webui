import { afterEach, describe, expect, it } from 'vitest';
import { tmpStore, type TmpStores } from '../test/tmpStore.js';

describe('SettingsStore', () => {
  let stores: TmpStores;

  afterEach(() => {
    stores?.cleanup();
  });

  describe('diskLabels merge', () => {
    it('starts empty', async () => {
      stores = tmpStore();
      const settings = await stores.settingsStore.get();
      expect(settings.diskLabels).toEqual({});
    });

    it('adds a label without touching other keys', async () => {
      stores = tmpStore();
      await stores.settingsStore.update({ diskLabels: { 'disk-a': 'Media' } });
      await stores.settingsStore.update({ diskLabels: { 'disk-b': 'Backups' } });
      const settings = await stores.settingsStore.get();
      expect(settings.diskLabels).toEqual({ 'disk-a': 'Media', 'disk-b': 'Backups' });
    });

    it('overwrites an existing label for the same disk', async () => {
      stores = tmpStore();
      await stores.settingsStore.update({ diskLabels: { 'disk-a': 'Media' } });
      await stores.settingsStore.update({ diskLabels: { 'disk-a': 'Renamed' } });
      const settings = await stores.settingsStore.get();
      expect(settings.diskLabels).toEqual({ 'disk-a': 'Renamed' });
    });

    it('removes a label entirely when patched with an empty string, instead of persisting it', async () => {
      stores = tmpStore();
      await stores.settingsStore.update({ diskLabels: { 'disk-a': 'Media', 'disk-b': 'Backups' } });
      await stores.settingsStore.update({ diskLabels: { 'disk-a': '' } });
      const settings = await stores.settingsStore.get();
      expect(settings.diskLabels).toEqual({ 'disk-b': 'Backups' });
    });

    it('leaves diskLabels untouched when a patch omits the key entirely', async () => {
      stores = tmpStore();
      await stores.settingsStore.update({ diskLabels: { 'disk-a': 'Media' } });
      await stores.settingsStore.update({ minFreeSpaceGb: 8 });
      const settings = await stores.settingsStore.get();
      expect(settings.diskLabels).toEqual({ 'disk-a': 'Media' });
      expect(settings.minFreeSpaceGb).toBe(8);
    });

    it('get() returns a fresh copy each call, not a shared reference', async () => {
      stores = tmpStore();
      await stores.settingsStore.update({ diskLabels: { 'disk-a': 'Media' } });
      const first = await stores.settingsStore.get();
      first.diskLabels['disk-a'] = 'Mutated locally';
      const second = await stores.settingsStore.get();
      expect(second.diskLabels['disk-a']).toBe('Media');
    });
  });

  describe('notifications.eventTypes merge', () => {
    it('touching one event does not blow away another already-persisted event', async () => {
      stores = tmpStore();
      await stores.settingsStore.update({ notifications: { eventTypes: { diskFailed: { apprise: false, webui: false } } } });
      await stores.settingsStore.update({ notifications: { eventTypes: { smartFailed: { apprise: false, webui: true } } } });
      const settings = await stores.settingsStore.get();
      expect(settings.notifications.eventTypes.diskFailed).toEqual({ apprise: false, webui: false });
      expect(settings.notifications.eventTypes.smartFailed).toEqual({ apprise: false, webui: true });
      // Untouched events keep their catalog default.
      expect(settings.notifications.eventTypes.parityErrors).toEqual({ apprise: true, webui: true });
    });

    it('a patch touching only one channel does not reset the other channel on the same event', async () => {
      stores = tmpStore();
      await stores.settingsStore.update({ notifications: { eventTypes: { diskFailed: { apprise: false, webui: false } } } });
      await stores.settingsStore.update({ notifications: { eventTypes: { diskFailed: { webui: true } } } });
      const settings = await stores.settingsStore.get();
      expect(settings.notifications.eventTypes.diskFailed).toEqual({ apprise: false, webui: true });
    });
  });
});
