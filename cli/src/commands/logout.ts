import { clearConfig, loadConfig } from '../config.js';
import { passwordLogin } from '../api/sessionAuth.js';

interface LogoutOptions {
  revoke?: boolean;
}

/**
 * By design (see backend/src/auth/service.ts's createApiToken/revokeApiToken doc comments), a
 * token can never revoke itself or any other token - only a real session can. So plain `nonraid
 * logout` just forgets the token locally; the token stays valid server-side until an admin revokes
 * it (currently only possible with a session, e.g. `--revoke` here, which re-prompts for the
 * password to get one, or a future web UI token-management page). This mirrors "losing your laptop
 * doesn't revoke your SSH key" - local logout and server-side revocation are deliberately separate
 * operations.
 */
export async function logoutCommand(opts: LogoutOptions): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    console.log('Not logged in - nothing to do.');
    return;
  }

  if (opts.revoke) {
    // Revocation is session-gated only, not step-up (see routes/auth.ts) - removing access is
    // strictly safety-positive, unlike minting a new token.
    const { cookie } = await passwordLogin(config.host);
    const res = await fetch(`${config.host}/api/auth/tokens/${config.tokenId}`, { method: 'DELETE', headers: { Cookie: cookie } });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Could not revoke token (${res.status}).`);
    }
    console.log('Token revoked on the server.');
  }

  await clearConfig();
  console.log('Logged out.');
}
