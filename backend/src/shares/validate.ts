import { HttpError } from '../httpError.js';
import type { AllocationMethod, ShareInput, ShareProtocol } from './types.js';

const NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/;
const ALLOCATION_METHODS: AllocationMethod[] = ['most-free', 'fill-up', 'high-water', 'single-disk'];
const PROTOCOLS: ShareProtocol[] = ['smb', 'nfs'];

export function validateShareInput(input: unknown): ShareInput {
  if (typeof input !== 'object' || input === null) {
    throw new HttpError(400, 'Request body must be a JSON object.');
  }
  const i = input as Record<string, unknown>;

  if (typeof i.name !== 'string' || !NAME_RE.test(i.name)) {
    throw new HttpError(400, 'Share name must be 1-32 characters: letters, numbers, dash, underscore.');
  }
  if (!Array.isArray(i.disks) || i.disks.length === 0 || !i.disks.every((d) => Number.isInteger(d) && d >= 1 && d <= 28)) {
    throw new HttpError(400, 'A share needs at least one data disk slot (1-28).');
  }
  if (typeof i.allocationMethod !== 'string' || !ALLOCATION_METHODS.includes(i.allocationMethod as AllocationMethod)) {
    throw new HttpError(400, `allocationMethod must be one of: ${ALLOCATION_METHODS.join(', ')}`);
  }
  if (i.allocationMethod === 'single-disk' && i.disks.length !== 1) {
    throw new HttpError(400, 'Single-disk allocation requires exactly one disk.');
  }
  if (i.allDisks !== undefined && typeof i.allDisks !== 'boolean') {
    throw new HttpError(400, 'allDisks must be a boolean.');
  }
  if (i.allDisks === true && i.allocationMethod === 'single-disk') {
    throw new HttpError(400, 'allDisks cannot be combined with single-disk allocation.');
  }
  if (
    !Array.isArray(i.protocols) ||
    i.protocols.length === 0 ||
    !i.protocols.every((p) => PROTOCOLS.includes(p as ShareProtocol))
  ) {
    throw new HttpError(400, `protocols must be a non-empty array of: ${PROTOCOLS.join(', ')}`);
  }
  if (i.description !== undefined && typeof i.description !== 'string') {
    throw new HttpError(400, 'description must be a string.');
  }
  const description = typeof i.description === 'string' ? i.description.trim().slice(0, 200) : undefined;

  return {
    name: i.name,
    disks: i.disks as number[],
    allDisks: i.allDisks === true,
    allocationMethod: i.allocationMethod as AllocationMethod,
    protocols: i.protocols as ShareProtocol[],
    smb: i.smb as ShareInput['smb'],
    nfs: i.nfs as ShareInput['nfs'],
    description: description || undefined,
  };
}
