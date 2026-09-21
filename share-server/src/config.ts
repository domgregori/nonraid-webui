import { randomBytes } from 'node:crypto';
import path from 'node:path';

// Same env-var-only convention as backend/src/config.ts - no config file, one override mechanism.
function str(envName: string, fallback: string): string {
  const envVal = process.env[envName];
  return envVal !== undefined ? envVal : fallback;
}
function num(envName: string, fallback: number): number {
  const envVal = process.env[envName];
  return envVal !== undefined ? Number(envVal) : fallback;
}

// Ephemeral fallback for local dev only - a real deployment always has SHARE_UNLOCK_SECRET set
// (tools/install-webui.sh's provision_share_server_state() generates it once into
// /etc/default/nonraid-share-server, the EnvironmentFile this unit's own systemd ExecStart reads).
// Without a *stable* secret, every restart would invalidate every visitor's unlock cookie - fine
// for dev iteration, not acceptable in production, hence the loud warning at startup (see index.ts).
const generatedDevSecret = randomBytes(32).toString('hex');

export const config = {
  port: num('SHARE_SERVER_PORT', 8877),
  // Loopback only - never anything else. The Cloudflare Tunnel (cloudflared, its own systemd
  // unit) is the only thing that should ever reach this port from outside this host; verify with
  // `ss -tlnp` after starting.
  host: str('SHARE_SERVER_HOST', '127.0.0.1'),
  // Matches backend/src/config.ts's shareRpcSocketPath default - both processes must agree on
  // this path. Overridable for local dev the same way the admin backend's own default is.
  shareRpcSocketPath: str('SHARE_RPC_SOCKET_PATH', '/run/nonraid-webui/share-rpc.sock'),
  // Independent from the admin backend's own session secret by design (see the plan's "share-
  // server's unlock cookie uses its own independent SHARE_UNLOCK_SECRET" note) - a compromise of
  // one secret should never let an attacker forge the other kind of credential.
  shareUnlockSecret: str('SHARE_UNLOCK_SECRET', generatedDevSecret),
  shareUnlockSecretIsEphemeral: process.env.SHARE_UNLOCK_SECRET === undefined,
  // How long an unlock cookie stays valid before a visitor has to re-enter the share's password
  // (if any) - independent of the admin session's own much longer TTL; a public, potentially
  // shared/forwarded link deserves a shorter-lived credential.
  unlockCookieTtlMs: num('SHARE_UNLOCK_COOKIE_TTL_MS', 24 * 60 * 60 * 1000),
  // How long a successful resolveShareForOp result is cached in memory, keyed by shareId - the
  // plan's own stated freshness tradeoff: a revocation can take up to this long to fully take
  // effect for someone already mid-session, in exchange for not round-tripping the RPC socket on
  // every single file click. Upload's quota reserve/true-up calls never consult this cache.
  resolveShareCacheTtlMs: num('SHARE_RESOLVE_CACHE_TTL_MS', 30_000),
  rpcRequestTimeoutMs: num('SHARE_RPC_REQUEST_TIMEOUT_MS', 10_000),
  rpcReconnectMinDelayMs: num('SHARE_RPC_RECONNECT_MIN_DELAY_MS', 500),
  rpcReconnectMaxDelayMs: num('SHARE_RPC_RECONNECT_MAX_DELAY_MS', 10_000),
  loginRateLimitWindowMs: num('SHARE_UNLOCK_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  loginRateLimitMax: num('SHARE_UNLOCK_RATE_LIMIT_MAX', 20),
  uploadRateLimitWindowMs: num('SHARE_UPLOAD_RATE_LIMIT_WINDOW_MS', 60 * 1000),
  uploadRateLimitMax: num('SHARE_UPLOAD_RATE_LIMIT_MAX', 30),
  // Built public-share bundle this process serves directly (static + SPA fallback, scoped to skip
  // /api/*) - see tools/install-webui.sh's stage_public_share_frontend().
  publicShareDistPath: str('PUBLIC_SHARE_DIST_PATH', path.join(process.cwd(), '..', 'public-share', 'dist')),
  serveFrontend: str('SERVE_PUBLIC_SHARE_FRONTEND', 'true') !== 'false',
  // Where uploads land before the destination path is validated and they're renamed into place -
  // same temp-then-rename shape backend/src/browse/service.ts's saveUpload() uses.
  uploadTmpDir: str('SHARE_UPLOAD_TMP_DIR', path.join(process.cwd(), 'tmp', 'uploads')),
};
