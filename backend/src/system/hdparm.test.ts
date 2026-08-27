import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config.js';
import { createFakeNmdClient } from '../test/fakeNmdClient.js';

const runSudoMaybe = vi.fn(async () => ({ stdout: '', stderr: '' }));
const getDiskType = vi.fn(async (): Promise<boolean | null> => false);

vi.mock('./procUtil.js', () => ({
  runSudoMaybe: (...args: unknown[]) => runSudoMaybe(...(args as [string, string[]])),
}));
vi.mock('./diskType.js', () => ({
  getDiskType: (...args: unknown[]) => getDiskType(...(args as [string])),
}));

const { spinDown, spinUp, setSpinDownTimeout, applySpinDownTimeout } = await import('./hdparm.js');

describe('hdparm', () => {
  beforeEach(() => {
    runSudoMaybe.mockClear();
    getDiskType.mockClear();
    getDiskType.mockResolvedValue(false); // default: real HDD
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('spinDown / spinUp', () => {
    it('spins down via hdparm -y on the /dev/-prefixed device', async () => {
      await spinDown('sdb');
      expect(runSudoMaybe).toHaveBeenCalledWith(config.hdparmBin, ['-y', '/dev/sdb']);
    });

    it('leaves an already-/dev/-prefixed device alone', async () => {
      await spinDown('/dev/sdb');
      expect(runSudoMaybe).toHaveBeenCalledWith(config.hdparmBin, ['-y', '/dev/sdb']);
    });

    it('spins up via a direct-I/O dd read, bypassing the page cache', async () => {
      await spinUp('sdc');
      expect(runSudoMaybe).toHaveBeenCalledWith('dd', ['if=/dev/sdc', 'of=/dev/null', 'bs=512', 'count=1', 'iflag=direct']);
    });
  });

  describe('setSpinDownTimeout minute -> hdparm -S code conversion', () => {
    // Every value here is a real preset offered by Settings > Array (SettingsPage.tsx);
    // the underlying encoding (man hdparm): 0 disables; 1-240 are 5s units (<=20min);
    // 241-251 are 30min units, clamped at 251 (5.5hr).
    it.each([
      [0, 0],
      [-5, 0], // disables just like 0
      [5, 60],
      [10, 120],
      [15, 180],
      [20, 240], // exactly the 5s-unit boundary (1200s)
      [30, 241], // just past the boundary, switches to 30min units
      [60, 242],
      [120, 244],
      [180, 246],
      [240, 248],
      [300, 250],
      [330, 251], // 5.5hr - the true max, still within the clamp
      [10000, 251], // far past max - clamped rather than overflowing the byte field
    ])('%d minutes -> hdparm -S code %d', async (minutes, expectedCode) => {
      await setSpinDownTimeout('sdb', minutes);
      expect(runSudoMaybe).toHaveBeenCalledWith(config.hdparmBin, ['-S', String(expectedCode), '/dev/sdb']);
    });
  });

  describe('applySpinDownTimeout', () => {
    it('programs the timeout on every real HDD in the array', async () => {
      const nmd = createFakeNmdClient();
      await applySpinDownTimeout(nmd, 20);
      // fixture has 3 disks: /dev/sda (parity), /dev/sdb, /dev/sdc - all real HDDs by the mock default
      expect(getDiskType).toHaveBeenCalledTimes(3);
      expect(runSudoMaybe).toHaveBeenCalledTimes(3);
      expect(runSudoMaybe).toHaveBeenCalledWith(config.hdparmBin, ['-S', '240', '/dev/sda']);
      expect(runSudoMaybe).toHaveBeenCalledWith(config.hdparmBin, ['-S', '240', '/dev/sdb']);
      expect(runSudoMaybe).toHaveBeenCalledWith(config.hdparmBin, ['-S', '240', '/dev/sdc']);
    });

    it('skips SSDs', async () => {
      getDiskType.mockImplementation(async (device: string) => (device === '/dev/sdb' ? true : false));
      const nmd = createFakeNmdClient();
      await applySpinDownTimeout(nmd, 10);
      expect(runSudoMaybe).toHaveBeenCalledTimes(2);
      expect(runSudoMaybe).not.toHaveBeenCalledWith(config.hdparmBin, expect.arrayContaining(['/dev/sdb']));
    });

    it('skips disks whose type is unknown (null)', async () => {
      getDiskType.mockResolvedValue(null);
      const nmd = createFakeNmdClient();
      await applySpinDownTimeout(nmd, 10);
      expect(runSudoMaybe).not.toHaveBeenCalled();
    });

    it('skips disks with no device or a "none" device', async () => {
      const nmd = createFakeNmdClient({
        getStatus: async () => {
          const status = await createFakeNmdClient().getStatus();
          return { ...status, disks: [{ ...status.disks[0]!, device: 'none' }, { ...status.disks[1]!, device: '' }] };
        },
      });
      await applySpinDownTimeout(nmd, 10);
      expect(getDiskType).not.toHaveBeenCalled();
      expect(runSudoMaybe).not.toHaveBeenCalled();
    });

    it('is best-effort: one drive failing to respond does not stop the others from being programmed', async () => {
      runSudoMaybe.mockImplementation(async (_bin: string, args: string[]) => {
        if (args.includes('/dev/sdb')) throw new Error('hdparm: device busy');
        return { stdout: '', stderr: '' };
      });
      const nmd = createFakeNmdClient();
      await expect(applySpinDownTimeout(nmd, 10)).resolves.toBeUndefined();
      expect(runSudoMaybe).toHaveBeenCalledTimes(3);
    });
  });
});
