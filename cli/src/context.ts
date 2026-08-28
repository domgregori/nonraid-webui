import { loadConfig } from './config.js';
import { ApiClient } from './api/client.js';

// Resolution order for every command except `login` itself: env vars first (scripting/CI - no
// dependency on a config file existing at all), then the saved config from `nonraid login`.
// Mirrors backend/src/config.ts's own "env var > fallback" convention, just with the config file
// standing in for the hardcoded fallback.
export async function resolveClient(): Promise<ApiClient> {
  const config = await loadConfig();
  const host = process.env.NONRAID_HOST ?? config?.host;
  const token = process.env.NONRAID_TOKEN ?? config?.token;
  const insecure = process.env.NONRAID_INSECURE === '1' || config?.insecure === true;

  if (!host || !token) {
    console.error('Not logged in. Run `nonraid login` first (or set NONRAID_HOST / NONRAID_TOKEN).');
    process.exit(1);
  }

  return new ApiClient({ host, token, insecure });
}
