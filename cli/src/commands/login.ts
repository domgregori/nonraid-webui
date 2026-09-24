import os from 'node:os';
import prompts from 'prompts';
import { passwordLogin, stepUpFetch } from '../api/sessionAuth.js';
import { saveConfig } from '../config.js';

interface LoginOptions {
  host?: string;
  insecure?: boolean;
  readOnly?: boolean;
  token?: string;
}

interface CreateTokenResponse {
  id: string;
  name: string;
  scope: 'full' | 'read-only';
  createdAt: number;
  token: string;
}

async function resolveHost(optHost?: string): Promise<string> {
  let host = optHost ?? process.env.NONRAID_HOST;
  if (!host) {
    const answer = await prompts({ type: 'text', name: 'host', message: 'Backend URL', initial: 'http://nonraid.lan' }, { onCancel: () => process.exit(130) });
    host = answer.host;
  }
  if (!host) throw new Error('A backend URL is required.');
  return host.replace(/\/+$/, '');
}

/**
 * `--token` path: skip username/password entirely and save an API token that was already minted
 * in the web UI (Settings > API). The token is verified against a real authenticated endpoint
 * before being saved, so a typo fails loudly here instead of on the next command. No `tokenId` is
 * stored - a bearer token can't look up its own id (the /auth/tokens endpoints are session-gated,
 * not token-gated), so `nwctl logout --revoke` can't revoke a `--token` session; revoke it
 * from Settings > API in the web UI instead (see logout.ts).
 */
async function tokenLogin(base: string, token: string, insecure: boolean): Promise<void> {
  const res = await fetch(`${base}/api/status`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new Error('That token was rejected (401). Check it was copied in full and has not been revoked.');
  if (!res.ok) throw new Error(`Could not verify the token against ${base} (${res.status}).`);

  await saveConfig({ host: base, token, insecure: insecure || undefined });
  console.log(`Saved API token for ${base}. Future commands won't ask for a password.`);
  console.log('Note: `nwctl logout --revoke` cannot revoke this token - do that from Settings > API in the web UI.');
}

export async function loginCommand(opts: LoginOptions): Promise<void> {
  if (opts.token && opts.readOnly) {
    throw new Error('--read-only only applies when minting a new token; --token uses the scope the existing token already has.');
  }

  if (opts.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const base = await resolveHost(opts.host);

  if (opts.token) {
    await tokenLogin(base, opts.token, !!opts.insecure);
    return;
  }

  const { cookie, password } = await passwordLogin(base);

  const defaultName = `nwctl@${os.hostname()}`;
  const { tokenName } = await prompts({ type: 'text', name: 'tokenName', message: 'Name for this token', initial: defaultName }, { onCancel: () => process.exit(130) });

  // POST /auth/tokens is step-up gated (same class of risk as adding a trusted SSH key) -
  // stepUpFetch supplies the password and only prompts for a fresh 2FA code if the backend asks.
  const scope = opts.readOnly ? 'read-only' : 'full';
  const created = (await stepUpFetch(base, '/api/auth/tokens', 'POST', cookie, password, { name: tokenName || defaultName, scope })) as CreateTokenResponse;

  await saveConfig({ host: base, token: created.token, tokenId: created.id, insecure: !!opts.insecure });
  console.log(`Logged in as ${base}. Token "${created.name}" (${created.scope}) saved - future commands won't ask for a password again.`);
}
