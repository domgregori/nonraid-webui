import dns from 'node:dns/promises';
import { isIP } from 'node:net';

// The three named subnet aliases Express's own 'trust proxy' setting understands directly (see
// the trust-proxy library it delegates to) - passed through unchanged rather than treated as a
// hostname to resolve.
const TRUST_PROXY_KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);

/**
 * Resolves a raw "trusted proxy address" setting - comma/space-separated IPs, CIDR ranges, the
 * named keywords above, or a hostname/FQDN - into the exact value to hand to Express's
 * `app.set('trust proxy', ...)`. A hostname gets resolved to its current IP address(es) here,
 * since Express's own trust-proxy value only ever understands addresses, not names (see
 * https://expressjs.com/en/guide/behind-proxies.html) - restricting which upstream hop's
 * X-Forwarded-* headers actually get trusted is the whole point of setting this, so a plain
 * `true` would defeat it.
 *
 * Empty input resolves to null, meaning "no specific address configured" - callers fall back to
 * blanket trust (`trust proxy: true`), matching this app's original all-or-nothing toggle.
 *
 * Throws a plain Error (not HttpError - both call sites, routes/settings.ts's PUT handler and
 * index.ts's boot path, only ever read `.message`, not a status code) if any entry can't be
 * resolved.
 */
export async function resolveTrustProxyValue(raw: string): Promise<string | null> {
  const entries = raw
    .split(/[,\s]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  if (entries.length === 0) return null;

  const resolved: string[] = [];
  for (const entry of entries) {
    const host = entry.split('/')[0] ?? entry; // strip a CIDR suffix (e.g. "10.0.0.0/8") before checking isIP
    if (TRUST_PROXY_KEYWORDS.has(entry) || isIP(host)) {
      resolved.push(entry);
      continue;
    }
    try {
      const addrs = await dns.lookup(entry, { all: true });
      if (addrs.length === 0) throw new Error('no addresses found');
      for (const a of addrs) resolved.push(a.address);
    } catch (err) {
      throw new Error(`Could not resolve trusted proxy address "${entry}": ${(err as Error).message}`);
    }
  }
  return resolved.join(',');
}
