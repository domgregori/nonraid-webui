import os from 'node:os';
import prompts from 'prompts';
import { passwordLogin, stepUpFetch } from '../api/sessionAuth.js';
import { saveConfig } from '../config.js';

interface LoginOptions {
  host?: string;
  insecure?: boolean;
}

interface CreateTokenResponse {
  id: string;
  name: string;
  createdAt: number;
  token: string;
}

export async function loginCommand(opts: LoginOptions): Promise<void> {
  let host = opts.host ?? process.env.NONRAID_HOST;
  if (!host) {
    const answer = await prompts({ type: 'text', name: 'host', message: 'Backend URL', initial: 'http://nonraid.lan' }, { onCancel: () => process.exit(130) });
    host = answer.host;
  }
  if (!host) throw new Error('A backend URL is required.');
  const base = host.replace(/\/+$/, '');

  if (opts.insecure) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

  const { cookie, password } = await passwordLogin(base);

  const defaultName = `nonraid-cli@${os.hostname()}`;
  const { tokenName } = await prompts({ type: 'text', name: 'tokenName', message: 'Name for this token', initial: defaultName }, { onCancel: () => process.exit(130) });

  // POST /auth/tokens is step-up gated (same class of risk as adding a trusted SSH key) -
  // stepUpFetch supplies the password and only prompts for a fresh 2FA code if the backend asks.
  const created = (await stepUpFetch(base, '/api/auth/tokens', 'POST', cookie, password, { name: tokenName || defaultName })) as CreateTokenResponse;

  await saveConfig({ host: base, token: created.token, tokenId: created.id, insecure: !!opts.insecure });
  console.log(`Logged in as ${host}. Token "${created.name}" saved - future commands won't ask for a password again.`);
}
