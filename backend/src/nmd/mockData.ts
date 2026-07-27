import { discoverRealDataDisks } from './discoverRealDisks.js';
import type { NmdDisk } from './types.js';

export interface MockDiskSeed {
  slot: number;
  type: 'P' | 'Q' | 'data';
  sizeGb: number;
  device: string;
  diskId: string;
  fsType: string;
  usedPct: number;
}

// Used only when no real disks are found at /mnt/disk1.. (e.g. a plain dev
// machine with no backend/testing/ container running). Sizes match the
// frontend's original design mock.
const FICTIONAL_DATA_DISKS = [
  { slot: 1, sizeGb: 4096, usedPct: 62 },
  { slot: 2, sizeGb: 4096, usedPct: 58 },
  { slot: 3, sizeGb: 8192, usedPct: 71 },
  { slot: 4, sizeGb: 8192, usedPct: 45 },
  { slot: 5, sizeGb: 8192, usedPct: 83 },
  { slot: 6, sizeGb: 10240, usedPct: 50 },
  { slot: 7, sizeGb: 10240, usedPct: 67 },
  { slot: 8, sizeGb: 12288, usedPct: 38 },
  { slot: 9, sizeGb: 14336, usedPct: 74 },
  { slot: 10, sizeGb: 16384, usedPct: 55 },
];

/** Deterministic per-slot baseline (°C), any slot count — not tied to a fixed 10-entry table. */
function baselineTemp(slot: number): number {
  return 28 + ((slot * 7) % 15); // 28–42°C
}

function buildDataDiskSeeds(): MockDiskSeed[] {
  const real = discoverRealDataDisks();
  if (real.length > 0) {
    return real.map((d) => ({
      slot: d.slot,
      type: 'data' as const,
      sizeGb: d.sizeGb,
      device: d.device,
      diskId: `MOCK_REAL_DISK_${d.slot}`,
      fsType: d.fsType,
      usedPct: d.usedPct,
    }));
  }
  return FICTIONAL_DATA_DISKS.map((d) => ({
    slot: d.slot,
    type: 'data' as const,
    sizeGb: d.sizeGb,
    device: `/dev/sd${String.fromCharCode(99 + d.slot)}`, // slot 1 -> sdd, slot 10 -> sdm
    diskId: `ATA_DISK${d.slot}_SERIAL`,
    fsType: 'xfs',
    usedPct: d.usedPct,
  }));
}

function buildParitySeeds(dataSeeds: MockDiskSeed[]): MockDiskSeed[] {
  // Parity must be >= the largest data disk, same rule a real array needs — sized
  // to match whichever data disk set is active so parity isn't absurdly oversized
  // next to real small test disks (or undersized next to the fictional big ones).
  const paritySizeGb = dataSeeds.length > 0 ? Math.max(...dataSeeds.map((d) => d.sizeGb)) : 1;
  return [
    { slot: 0, type: 'P' as const, sizeGb: paritySizeGb, device: '/dev/sdb', diskId: 'ATA_PARITY1_SERIAL', fsType: '—', usedPct: 0 },
    { slot: 29, type: 'Q' as const, sizeGb: paritySizeGb, device: '/dev/sdc', diskId: 'ATA_PARITY2_SERIAL', fsType: '—', usedPct: 0 },
  ];
}

/** Recomputed on every call — cheap (a /proc/mounts read + statfs per disk) and
 *  keeps the mock array honestly in sync if the test container's real disks change. */
export function getMockDiskSeeds(): { parity: MockDiskSeed[]; data: MockDiskSeed[]; all: MockDiskSeed[] } {
  const data = buildDataDiskSeeds();
  const parity = buildParitySeeds(data);
  return { parity, data, all: [...parity, ...data] };
}

/** Every device string a mock disk could report, in either array state, mapped to its baseline temp. */
export function mockDeviceTemps(): Record<string, number> {
  const map: Record<string, number> = {};
  for (const seed of getMockDiskSeeds().data) {
    map[seed.device] = baselineTemp(seed.slot);
    map[`/dev/nmd${seed.slot}p1`] = baselineTemp(seed.slot);
  }
  return map;
}

export function buildMockDisk(seed: MockDiskSeed, arrayStarted: boolean): NmdDisk {
  const sizeKb = seed.sizeGb * 1024 * 1024;
  const isData = seed.type === 'data';

  const filesystem = isData
    ? {
        type: seed.fsType,
        mountpoint: arrayStarted ? `/mnt/disk${seed.slot}` : '-',
        // Real nmdctl's `usage` is literally `df -h`'s Use% column (get_fs_usage() in
        // tools/nmdctl) — just a percentage string, not a compound "used/total" one.
        usage: arrayStarted ? `${seed.usedPct}%` : '-',
      }
    : undefined;

  return {
    slot: seed.slot,
    type: seed.type,
    size_kb: sizeKb,
    size_gb: seed.sizeGb,
    device: arrayStarted ? `/dev/nmd${seed.slot}p1` : seed.device,
    status: 'DISK_OK',
    errors: 0,
    reads: arrayStarted ? 1_200_000 + seed.slot * 1000 : 0,
    writes: arrayStarted ? 340_000 + seed.slot * 500 : 0,
    disk_id: seed.diskId,
    disk_name: `disk${seed.slot}`,
    ...(filesystem ? { filesystem } : {}),
  };
}
