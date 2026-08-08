import { HttpError } from '../httpError.js';
import type { AvailableDevice } from './types.js';

/**
 * Layout confirmed directly against `mdp_superblock_s`/`mdp_disk_t` in
 * md_nonraid's md_unraid.h (the sibling nonraid repo): a fixed 4096-byte,
 * native-endian binary struct — 32 "common" words (128 bytes), then 30
 * fixed-size 128-byte disk descriptors, then one reserved descriptor
 * (128 + 30*128 + 128 = 4096). No serialization layer, so this reads it
 * directly with Buffer offsets rather than any parsing library.
 *
 * Deliberately doesn't verify sb_csum — the exact checksum algorithm isn't
 * confirmed precisely enough to safely reimplement, and it isn't needed for
 * safety here: the kernel re-validates it authoritatively at actual load
 * time in the commit step, so a subtly-wrong reimplementation here would
 * only be false precision, not a real gap. Magic number + structural sanity
 * (length) is the pre-check.
 */
const MD_SB_MAGIC = 0xb92b4efc;
const MD_SB_BYTES = 4096;
const MD_SB_DISKS = 30;
const MD_ID_SIZE = 80;
const COMMON_BYTES = 128; // 32 words
const DISK_DESCRIPTOR_BYTES = 128; // 32 words
const DISKS_OFFSET = COMMON_BYTES;
const LABEL_OFFSET = 64; // word 16
const LABEL_BYTES = 32;
const MD_DISK_VALID = 1 << 0;
const MD_SB_P_IDX = 0;
const MD_SB_Q_IDX = MD_SB_DISKS - 1;

export type SuperblockDiskRole = 'parity' | 'parity2' | 'data';

export interface ParsedSuperblockSlot {
  slot: number;
  role: SuperblockDiskRole;
  sizeKb: number;
  id: string;
}

export interface ParsedSuperblock {
  label: string;
  diskCount: number;
  slots: ParsedSuperblockSlot[];
}

function readCString(buf: Buffer, offset: number, maxLen: number): string {
  const end = buf.indexOf(0, offset);
  const stop = end === -1 || end > offset + maxLen ? offset + maxLen : end;
  return buf.toString('latin1', offset, stop).trim();
}

function roleForSlot(slot: number): SuperblockDiskRole {
  if (slot === MD_SB_P_IDX) return 'parity';
  if (slot === MD_SB_Q_IDX) return 'parity2';
  return 'data';
}

export function parseSuperblock(buf: Buffer): ParsedSuperblock {
  if (buf.length !== MD_SB_BYTES) {
    throw new HttpError(400, `Not a valid superblock file — expected exactly ${MD_SB_BYTES} bytes, got ${buf.length}.`);
  }
  const magic = buf.readUInt32LE(0);
  if (magic !== MD_SB_MAGIC) {
    throw new HttpError(400, 'Not a valid superblock file — magic number mismatch. Pick the original super.dat copied from the Unraid host.');
  }

  const label = readCString(buf, LABEL_OFFSET, LABEL_BYTES);

  const slots: ParsedSuperblockSlot[] = [];
  for (let slot = 0; slot < MD_SB_DISKS; slot++) {
    const base = DISKS_OFFSET + slot * DISK_DESCRIPTOR_BYTES;
    const state = buf.readUInt32LE(base + 12);
    if (!(state & MD_DISK_VALID)) continue;
    const sizeKb = Number(buf.readBigUInt64LE(base + 16));
    const id = readCString(buf, base + 24, MD_ID_SIZE);
    slots.push({ slot, role: roleForSlot(slot), sizeKb, id });
  }

  return { label, diskCount: slots.length, slots };
}

/** The "serial number" half of a udev-style `Model_Serial` id string — the
 * substring after the last underscore, or the whole string if there is none.
 * Mirrors same_disk_info()'s non-strict comparison in md_unraid.c exactly:
 * both sides of a match get this same transform applied independently. */
function serialPart(id: string): string {
  const idx = id.lastIndexOf('_');
  return idx === -1 ? id : id.slice(idx + 1);
}

export type DiskMatchStatus = 'ok' | 'size-mismatch' | 'missing';

export interface DiskMatch {
  status: DiskMatchStatus;
  disk: AvailableDevice | null;
}

/**
 * Predicts what the kernel's own same_disk_info() (md_unraid.c) would decide
 * at real import time: exact match on the serial-number portion of the id
 * string (not a substring/contains check — confirmed from source, strcmp on
 * the derived serial), and an exact size match. Both failing the same way
 * (DISK_WRONG) at the kernel level, but distinguished here for a clearer
 * preview: a size mismatch is the one this app hard-blocks on.
 */
export function matchSlotToDisk(slot: ParsedSuperblockSlot, disks: AvailableDevice[]): DiskMatch {
  const slotSerial = serialPart(slot.id);
  const candidate = disks.find((d) => d.diskId && serialPart(d.diskId) === slotSerial);
  if (!candidate) return { status: 'missing', disk: null };
  if (candidate.sizeKb !== slot.sizeKb) return { status: 'size-mismatch', disk: candidate };
  return { status: 'ok', disk: candidate };
}
