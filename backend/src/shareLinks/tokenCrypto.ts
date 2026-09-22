import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';

const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // standard GCM nonce size

/**
 * Reversible storage for a share link's own token - deliberately not a one-way hash (see
 * config.ts's shareTokenKeyPath doc comment for why that's fine here): the token's own 192 bits
 * of randomBytes() entropy is what resists guessing, not hash irreversibility. This key's only
 * job is to keep a raw SQLite file read from yielding instantly-usable tokens.
 *
 * A separate, independent SHA-256 hash (shareLinks/service.ts's tokenHash) still exists alongside
 * this and is what the RPC lookup path actually indexes on - that's an unrelated concern (fast,
 * O(1) point lookup by a fixed-length key) from this file's job (recovering the original token to
 * show/copy again later).
 */
let cachedKey: Buffer | null = null;

function getOrCreateKey(keyPath: string): Buffer {
  if (cachedKey) return cachedKey;
  if (existsSync(keyPath)) {
    const key = readFileSync(keyPath);
    if (key.length !== KEY_BYTES) {
      throw new Error(`Share token key at ${keyPath} is the wrong length (expected ${KEY_BYTES} bytes, got ${key.length}) - refusing to use it.`);
    }
    cachedKey = key;
    return key;
  }
  mkdirSync(path.dirname(keyPath), { recursive: true });
  const key = randomBytes(KEY_BYTES);
  writeFileSync(keyPath, key, { mode: 0o600 });
  chmodSync(keyPath, 0o600); // belt-and-suspenders in case an existing file had looser perms
  cachedKey = key;
  return key;
}

/** `iv:authTag:ciphertext`, each base64url - one column, easy to store/read as a single TEXT. */
export function encryptToken(token: string, keyPath: string): string {
  const key = getOrCreateKey(keyPath);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString('base64url')).join(':');
}

export function decryptToken(encrypted: string, keyPath: string): string {
  const key = getOrCreateKey(keyPath);
  const [ivB64, authTagB64, ciphertextB64] = encrypted.split(':');
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('Malformed encrypted share token (expected iv:authTag:ciphertext).');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64url'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64url')), decipher.final()]);
  return plaintext.toString('utf8');
}
