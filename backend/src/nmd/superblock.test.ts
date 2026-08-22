import { describe, expect, it } from 'vitest';
import { HttpError } from '../httpError.js';
import { matchSlotToDisk, parseSuperblock, type ParsedSuperblockSlot } from './superblock.js';
import type { AvailableDevice } from './types.js';

const MD_SB_MAGIC = 0xb92b4efc;
const MD_SB_BYTES = 4096;
const DISKS_OFFSET = 128;
const DISK_DESCRIPTOR_BYTES = 128;
const MD_DISK_VALID = 1;

/** Builds a 4096-byte superblock buffer with the given label and valid slots. */
function buildSuperblock(opts: { label?: string; slots?: Array<{ slot: number; state?: number; sizeKb?: number; id?: string }> } = {}): Buffer {
  const buf = Buffer.alloc(MD_SB_BYTES);
  buf.writeUInt32LE(MD_SB_MAGIC, 0);
  if (opts.label) buf.write(opts.label, 64, 'latin1');
  for (const s of opts.slots ?? []) {
    const base = DISKS_OFFSET + s.slot * DISK_DESCRIPTOR_BYTES;
    buf.writeUInt32LE(s.state ?? MD_DISK_VALID, base + 12);
    buf.writeBigUInt64LE(BigInt(s.sizeKb ?? 0), base + 16);
    if (s.id) buf.write(s.id, base + 24, 'latin1');
  }
  return buf;
}

function expectHttpError(fn: () => unknown, status: number, messagePart: string): void {
  try {
    fn();
    throw new Error('expected to throw');
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(status);
    expect((err as HttpError).message).toContain(messagePart);
  }
}

function disk(overrides: Partial<AvailableDevice> = {}): AvailableDevice {
  return {
    device: '/dev/sdb',
    partition: '/dev/sdb1',
    sizeKb: 4_000_000_000,
    diskId: 'WDC_WD40EFRX_ABCD1234',
    model: 'WDC WD40EFRX-68N32N0',
    uuid: null,
    locked: false,
    isSSD: false,
    ...overrides,
  };
}

describe('parseSuperblock', () => {
  it('parses label and valid slots with correct roles for P/Q/data', () => {
    const buf = buildSuperblock({
      label: 'MyArray',
      slots: [
        { slot: 0, sizeKb: 4_000_000_000, id: 'WDC_WD40EFRX_PPP000' },
        { slot: 1, sizeKb: 4_000_000_000, id: 'WDC_WD40EFRX_DDD111' },
        { slot: 5, sizeKb: 4_000_000_000, id: 'WDC_WD40EFRX_DDD555' },
        { slot: 29, sizeKb: 4_000_000_000, id: 'WDC_WD40EFRX_QQQ999' },
      ],
    });

    const parsed = parseSuperblock(buf);
    expect(parsed.label).toBe('MyArray');
    expect(parsed.diskCount).toBe(4);
    expect(parsed.slots).toHaveLength(4);
    expect(parsed.slots[0]).toEqual({ slot: 0, role: 'parity', sizeKb: 4_000_000_000, id: 'WDC_WD40EFRX_PPP000' });
    expect(parsed.slots[1]).toEqual({ slot: 1, role: 'data', sizeKb: 4_000_000_000, id: 'WDC_WD40EFRX_DDD111' });
    expect(parsed.slots[2]).toEqual({ slot: 5, role: 'data', sizeKb: 4_000_000_000, id: 'WDC_WD40EFRX_DDD555' });
    expect(parsed.slots[3]).toEqual({ slot: 29, role: 'parity2', sizeKb: 4_000_000_000, id: 'WDC_WD40EFRX_QQQ999' });
  });

  it('skips slots whose valid bit is clear', () => {
    const buf = buildSuperblock({
      slots: [
        { slot: 0, sizeKb: 1, id: 'a' },
        { slot: 3, state: 0, sizeKb: 1, id: 'b' },
        { slot: 7, sizeKb: 1, id: 'c' },
      ],
    });
    const parsed = parseSuperblock(buf);
    expect(parsed.diskCount).toBe(2);
    expect(parsed.slots.map((s) => s.slot)).toEqual([0, 7]);
  });

  it('returns an empty slot list for an all-invalid superblock', () => {
    const parsed = parseSuperblock(buildSuperblock());
    expect(parsed.diskCount).toBe(0);
    expect(parsed.slots).toEqual([]);
  });

  it('rejects a buffer that is not exactly 4096 bytes', () => {
    expectHttpError(
      () => parseSuperblock(Buffer.alloc(2048)),
      400,
      'expected exactly 4096 bytes',
    );
  });

  it('rejects a buffer with a mismatched magic number', () => {
    const buf = Buffer.alloc(MD_SB_BYTES);
    buf.writeUInt32LE(0xdeadbeef, 0);
    expectHttpError(
      () => parseSuperblock(buf),
      400,
      'magic number mismatch',
    );
  });

  it('trims trailing NUL padding from the label', () => {
    const buf = buildSuperblock({ label: 'ShortLabel' });
    const parsed = parseSuperblock(buf);
    expect(parsed.label).toBe('ShortLabel');
    expect(parsed.label).not.toContain('\u0000');
  });
});

describe('matchSlotToDisk', () => {
  const slot: ParsedSuperblockSlot = { slot: 1, role: 'data', sizeKb: 4_000_000_000, id: 'WDC_WD40EFRX_ABCD1234' };

  it('matches ok on serial + exact size', () => {
    const result = matchSlotToDisk(slot, [disk()]);
    expect(result).toEqual({ status: 'ok', disk: expect.objectContaining({ device: '/dev/sdb' }) });
  });

  it('matches on the serial portion only, ignoring the model prefix', () => {
    // Disk id without the model-prefix underscore form still derives the same serial.
    const result = matchSlotToDisk(slot, [disk({ diskId: 'ABCD1234' })]);
    expect(result.status).toBe('ok');
  });

  it('reports size-mismatch when serial matches but sizes differ', () => {
    const result = matchSlotToDisk(slot, [disk({ sizeKb: 2_000_000_000 })]);
    expect(result.status).toBe('size-mismatch');
    expect(result.disk).not.toBeNull();
  });

  it('reports missing when no disk serial matches', () => {
    const result = matchSlotToDisk(slot, [disk({ diskId: 'WDC_WD40EFRX_ZZZZ9999' })]);
    expect(result).toEqual({ status: 'missing', disk: null });
  });

  it('reports missing for a disk with no detectable id', () => {
    const result = matchSlotToDisk(slot, [disk({ diskId: null })]);
    expect(result.status).toBe('missing');
  });

  it('reports missing against an empty disk list', () => {
    const result = matchSlotToDisk(slot, []);
    expect(result).toEqual({ status: 'missing', disk: null });
  });

  it('matches on the serial substring even across a different brand/model prefix', () => {
    const result = matchSlotToDisk(slot, [disk({ diskId: 'OTHER_BRAND_ABCD1234' })]);
    expect(result.status).toBe('ok');
  });
});
