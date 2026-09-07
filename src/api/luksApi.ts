import { request } from './request';
import type { FormatAsLuksResult, LuksStatusResponse } from '../types/luksApi';

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

  unlock: (slot: number, passphrase?: string) =>
    request<{ ok: boolean; message: string }>(`/api/luks/${slot}/unlock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    }),

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
