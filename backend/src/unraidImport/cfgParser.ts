/**
 * Unraid's `.cfg` files (config/share.cfg, config/shares/*.cfg, config/disk.cfg, ...) are plain
 * `key="value"` lines, one per setting, with a `# Generated settings:` comment on top - no nesting,
 * no shell expansion despite the quoting. Confirmed against a real exported flash-drive backup
 * this session, not guessed from Unraid's docs.
 */
export function parseCfg(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1);
    }
    if (key) result[key] = value;
  }
  return result;
}

/** `config/passwd`'s plain colon-delimited format: username:uid:gid:home[:...]. Only the fields
 *  this importer needs. */
export function parsePasswd(content: string): { username: string; uid: number }[] {
  const out: { username: string; uid: number }[] = [];
  for (const line of content.split('\n')) {
    const fields = line.split(':');
    const username = fields[0];
    const uid = Number(fields[2]);
    if (!username || Number.isNaN(uid)) continue;
    out.push({ username, uid });
  }
  return out;
}
