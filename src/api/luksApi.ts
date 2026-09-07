import { request } from './request';
import type { FormatAsLuksResult, LuksStatusResponse, UnlockSecret } from '../types/luksApi';

/** btoa() needs a "binary string" (one code unit per byte) - built up in chunks rather than a
 *  single `String.fromCharCode(...bytes)` spread, which blows the call stack on anything but a
 *  small file. A real LUKS keyfile is capped low server-side anyway (see routes/luks.ts's own
 *  comment), but this is cheap insurance against a mis-selected large file regardless. */
async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export const luksApi = {
  getStatus: () => request<LuksStatusResponse>('/api/luks/status'),

  // Step-up gated server-side (see routes/luks.ts) - currentPassword (and totpCode, if the
  // account has TOTP enrolled) is the admin's own account password, entirely separate from
  // `passphrase`, the new secret being set on the disk itself.
  formatAsLuks: (slot: number, passphrase: string, currentPassword: string, totpCode?: string) =>
    request<FormatAsLuksResult>(`/api/disks/${slot}/format-luks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passphrase, currentPassword, totpCode }),
    }),

  // Not step-up gated - see routes/luks.ts's own comment on why lock/unlock sit in the same
  // operational tier as unassigning a disk, not the step-up tier.
  lock: (slot: number) => request<{ ok: boolean; message: string }>(`/api/luks/${slot}/lock`, { method: 'POST' }),

  // `secret` is either a typed passphrase or an uploaded keyfile (see types/luksApi.ts's
  // UnlockSecret) - a keyfile's bytes are read and base64-encoded here, at the point of sending,
  // and go out as plain JSON like every other call in this module (see routes/luks.ts's own
  // comment on why this isn't a real multipart upload); no keyfile content is ever written
  // anywhere client-side either.
  unlock: async (slot: number, secret?: UnlockSecret) => {
    const body = secret && 'keyfile' in secret ? { keyfileBase64: await fileToBase64(secret.keyfile) } : { passphrase: secret?.passphrase };
    return request<{ ok: boolean; message: string }>(`/api/luks/${slot}/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  },

  // Both step-up gated - re-key every unlocked encrypted disk at once (see routes/luks.ts).
  // `skippedLocked` is how many encrypted disks were locked (and so untouched) at the moment this
  // ran - not a failure, but the resulting unlockMode covers fewer disks than "every encrypted
  // disk" until those are unlocked and switched individually (see luks/service.ts's own comment).
  switchToStored: (passphrase: string, currentPassword: string, totpCode?: string) =>
    request<{ ok: boolean; message: string; disksUpdated: number; skippedLocked: number }>('/api/luks/unlock-mode/to-stored', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passphrase, currentPassword, totpCode }),
    }),

  switchToManual: (newPassphrase: string, currentPassword: string, totpCode?: string) =>
    request<{ ok: boolean; message: string; disksUpdated: number; skippedLocked: number }>('/api/luks/unlock-mode/to-manual', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newPassphrase, currentPassword, totpCode }),
    }),
};
