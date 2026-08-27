import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HttpError } from '../httpError.js';

// This process runs as root (see procUtil.ts's own doc comment), so os.homedir() resolves to
// /root - the same "typically /root" home config.ts's own settings-path fallback already relies
// on, reused here rather than hardcoding /root directly.
const AUTHORIZED_KEYS_PATH = path.join(os.homedir(), '.ssh', 'authorized_keys');

const KEY_TYPE_PATTERN = /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)$/;
const KEY_BODY_PATTERN = /^[A-Za-z0-9+/]+=*$/;

export interface SshKeyEntry {
  type: string;
  comment: string;
  /** Last 12 chars of the key body - enough to tell entries apart in the UI (and to target one
   *  for removal) without ever echoing a full public key back to the browser. */
  fingerprint: string;
  raw: string;
}

/** Validates one line the same way sshd itself parses authorized_keys - type, base64 body,
 *  optional trailing comment - same "validate before it ever reaches a file something else
 *  parses" spirit as hostConfig.ts's HOSTNAME_PATTERN. Not a shell-injection concern (this only
 *  ever gets written to a file, never passed to argv), but a malformed line would silently
 *  corrupt authorized_keys, so it's rejected up front instead. */
function parseLine(line: string): SshKeyEntry | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return null;
  const [type, body, ...commentParts] = trimmed.split(/\s+/);
  if (!type || !body || !KEY_TYPE_PATTERN.test(type) || !KEY_BODY_PATTERN.test(body)) return null;
  return { type, comment: commentParts.join(' '), fingerprint: body.slice(-12), raw: trimmed };
}

async function readRawLines(): Promise<string[]> {
  try {
    const content = await readFile(AUTHORIZED_KEYS_PATH, 'utf8');
    return content.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function writeRawLines(lines: string[]): Promise<void> {
  // sshd refuses to honor authorized_keys (or its parent dir) if it's group/world-writable, so
  // getting these modes right is functional, not just hygiene - same reasoning tls.ts's
  // key.pem chmod(0o600) comment gives for its own cert material.
  await mkdir(path.dirname(AUTHORIZED_KEYS_PATH), { recursive: true, mode: 0o700 });
  const content = lines.length > 0 ? `${lines.join('\n')}\n` : '';
  await writeFile(AUTHORIZED_KEYS_PATH, content, { mode: 0o600 });
  // writeFile's mode is only applied when the file is newly created, not on an already-existing
  // one - chmod explicitly so an existing file with looser permissions actually gets corrected.
  await chmod(AUTHORIZED_KEYS_PATH, 0o600);
}

export async function listAuthorizedKeys(): Promise<SshKeyEntry[]> {
  const lines = await readRawLines();
  return lines.map(parseLine).filter((e): e is SshKeyEntry => e !== null);
}

export async function addAuthorizedKey(rawKey: string): Promise<void> {
  const parsed = parseLine(rawKey);
  if (!parsed) {
    throw new HttpError(400, 'That doesn\'t look like a valid SSH public key (expected e.g. "ssh-ed25519 AAAA... comment").');
  }
  const lines = await readRawLines();
  if (lines.includes(parsed.raw)) throw new HttpError(400, 'That key is already added.');
  lines.push(parsed.raw);
  await writeRawLines(lines);
}

export async function removeAuthorizedKey(fingerprint: string): Promise<void> {
  const lines = await readRawLines();
  const next = lines.filter((l) => parseLine(l)?.fingerprint !== fingerprint);
  if (next.length === lines.length) throw new HttpError(404, 'Key not found.');
  await writeRawLines(next);
}
