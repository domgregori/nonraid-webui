import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Line-based get/set against an LXC container's `config` file — this repo's
 * equivalent of the reference plugin's `getVariable`/`setVariable` PHP
 * helpers (see the LXC handoff doc). Real LXC directives (`lxc.start.auto =
 * 1`) and this app's own comment-prefixed pseudo-metadata (`#container_
 * description = ...`) both use the same `key = value` line shape, so one
 * pair of functions handles both — the container's config file stays the
 * only "database" for its app-level metadata, fully inspectable outside
 * this app, matching the reference plugin's design.
 *
 * Pure file I/O, no shell-out — unlike the PHP reference (which builds
 * shell_exec strings from these same values), there is no injection surface
 * here.
 *
 * The line-parsing logic itself (`parseVariable`/`applyVariable`) is
 * exported as pure string → string functions, separate from the fs-backed
 * ones below, so MockLxcClient can run identical parsing against its
 * in-memory config text — one implementation of the format, not two
 * drifting copies.
 */

function findLineIndex(lines: string[], key: string): number {
  const prefix = `${key} =`;
  const prefixNoSpace = `${key}=`;
  return lines.findIndex((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith(prefix) || trimmed.startsWith(prefixNoSpace);
  });
}

export function parseVariable(content: string, key: string): string | null {
  const lines = content.split('\n');
  const idx = findLineIndex(lines, key);
  if (idx === -1) return null;
  const line = lines[idx] ?? '';
  const eq = line.indexOf('=');
  return eq === -1 ? null : line.slice(eq + 1).trim();
}

/** Set (or, when value is null, remove) one `key = value` line, returning the
 * updated content. */
export function applyVariable(content: string, key: string, value: string | null): string {
  // A value containing \r/\n would otherwise split into extra physical
  // lines once written, letting one field's value inject arbitrary
  // additional lxc.* directives into the config file.
  if (value !== null && /[\r\n]/.test(value)) {
    throw new Error(`Value for "${key}" must not contain line breaks`);
  }
  const hadTrailingNewline = content.endsWith('\n');
  const lines = content.length > 0 ? content.split('\n') : [];
  const idx = findLineIndex(lines, key);

  if (value === null) {
    if (idx !== -1) lines.splice(idx, 1);
  } else if (idx === -1) {
    if (lines.length > 0 && lines.at(-1) === '') lines.pop();
    lines.push(`${key} = ${value}`);
  } else {
    lines[idx] = `${key} = ${value}`;
  }

  return lines.join('\n') + (hadTrailingNewline || lines.length > 0 ? '\n' : '');
}

/** Temp-file-then-rename so a concurrent read never sees a half-written file. */
async function atomicWrite(configPath: string, content: string): Promise<void> {
  const tmpPath = path.join(path.dirname(configPath), `.${path.basename(configPath)}.${randomBytes(4).toString('hex')}.tmp`);
  await fs.writeFile(tmpPath, content, 'utf8');
  await fs.rename(tmpPath, configPath);
}

/** Raw read of the whole config file — backs the LXC page's "Edit config"
 * dialog, where a user edits the actual on-disk file directly rather than
 * going through the curated autostart/description/webUiUrl fields. */
export async function readRaw(configPath: string): Promise<string> {
  return fs.readFile(configPath, 'utf8').catch(() => '');
}

export async function writeRaw(configPath: string, content: string): Promise<void> {
  await atomicWrite(configPath, content);
}

export async function getVariable(configPath: string, key: string): Promise<string | null> {
  const content = await readRaw(configPath);
  return content ? parseVariable(content, key) : null;
}

export async function setVariable(configPath: string, key: string, value: string | null): Promise<void> {
  const content = await readRaw(configPath);
  await atomicWrite(configPath, applyVariable(content, key, value));
}

export async function setVariables(configPath: string, entries: [key: string, value: string | null][]): Promise<void> {
  for (const [key, value] of entries) {
    await setVariable(configPath, key, value);
  }
}
