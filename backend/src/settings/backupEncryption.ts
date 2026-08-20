import type { RcloneClient } from '../rclone/client.js';
import type { BackupEncryption } from './types.js';

/**
 * Shared by both places `BackupEncryption` gets saved from a request body - Local Backups'
 * schedule (routes/settings.ts's PUT /settings) and each Remote Backup sync job (routes/rclone.ts's
 * POST/PUT /rclone/jobs) - so the "obscure a freshly-typed password, otherwise leave the saved one
 * alone" rule only lives in one place. See BackupEncryption's own doc comment (types.ts) for the
 * full reasoning.
 *
 * Wire shape for `input`: `{ enabled?, password? }` - `password` is plaintext and write-only
 * (never a field on the persisted record), obscured here via RcloneClient.obscure() before it
 * touches a store. Blank/absent `password` means "leave the current saved password alone" (same
 * "leave blank to keep the current value" pattern this app already uses for a remote's own
 * isPassword provider fields) - only turning `enabled` on with nothing ever saved requires one.
 * Returns `undefined` when `input` itself is absent, so callers can spread it into a patch without
 * accidentally clobbering an untouched field.
 */
export async function resolveEncryptionPatch(client: RcloneClient, input: unknown, existing: BackupEncryption | null): Promise<BackupEncryption | undefined> {
  if (!input || typeof input !== 'object') return undefined;
  const { enabled, password } = input as Record<string, unknown>;
  if (enabled !== undefined && typeof enabled !== 'boolean') throw new Error('encryption.enabled must be a boolean.');
  if (password !== undefined && typeof password !== 'string') throw new Error('encryption.password must be a string.');
  const passwordObscured = password ? await client.obscure(password) : (existing?.passwordObscured ?? null);
  const resolvedEnabled = enabled ?? existing?.enabled ?? false;
  if (resolvedEnabled && !passwordObscured) throw new Error('Enter a password to enable encryption.');
  return { enabled: resolvedEnabled, passwordObscured };
}

/** Never round-trips the real (obscured) password back to the client - see resolveEncryptionPatch's
 *  own doc comment. `hasPassword` is all the client ever needs: whether saving with encryption
 *  still on and no new password typed will keep working. */
export function redactEncryption(encryption: BackupEncryption): { enabled: boolean; hasPassword: boolean } {
  return { enabled: encryption.enabled, hasPassword: encryption.passwordObscured !== null };
}
