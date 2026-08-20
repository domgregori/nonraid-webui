import { createDecipheriv } from 'node:crypto';

/**
 * Reverses rclone's own `core/obscure` RC call (see realClient.ts's obscure()) locally, without a
 * matching RC call - confirmed live against a real `rclone rcd` instance (root@nonraid.lan,
 * rclone v1.75.0): `POST /rc/list` enumerates every RC command that build exposes, and it has
 * `core/obscure` but no reveal/unobscure counterpart at all (`rclone obscure --help` confirms the
 * CLI is one-directional too - "This is not a secure way of encrypting these passwords as rclone
 * *can* decrypt them", but that decryption only ever happens internally when rclone reads its own
 * config file, never as a command anyone can call).
 *
 * This backend still needs the real plaintext to hand to `openssl enc` for a scheduled/unattended
 * run, so this reimplements rclone's own algorithm directly (`fs/config/obscure` in rclone's
 * source: AES-256-CFB, a fixed non-secret key baked into every rclone build, a random 16-byte IV
 * prefixed to the base64url-encoded ciphertext) rather than inventing a different scheme -
 * verified end-to-end against a real obscured value from that same rcd instance's own
 * `core/obscure` response before being relied on here. Same "not real security" trust boundary
 * rclone itself documents and this app's own password-storage design already accepted (see the
 * handoff doc's "Password storage" decision) - this key is public, obscuring only deters
 * shoulder-surfing a config file, never intended to resist someone who can already read it.
 */
const RCLONE_OBSCURE_KEY = Buffer.from([
  0x9c, 0x93, 0x5b, 0x48, 0x73, 0x0a, 0x55, 0x4d, 0x6b, 0xfd, 0x7c, 0x63, 0xc8, 0x86, 0xa9, 0x2b, 0xd3, 0x90, 0x19, 0x8e, 0xb8, 0x12, 0x8a, 0xfb, 0xf4,
  0xde, 0x16, 0x2b, 0x8b, 0x95, 0xf6, 0x38,
]);

function base64UrlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
}

export function revealRcloneObscured(obscured: string): string {
  const data = base64UrlDecode(obscured);
  if (data.length < 16) throw new Error('Obscured password is malformed (too short).');
  const iv = data.subarray(0, 16);
  const ciphertext = data.subarray(16);
  const decipher = createDecipheriv('aes-256-cfb', RCLONE_OBSCURE_KEY, iv);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plain.toString('utf8');
}
