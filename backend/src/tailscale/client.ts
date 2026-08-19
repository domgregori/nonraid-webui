import type { TailscaleLoginResult, TailscaleSetOptions, TailscaleStatus } from './types.js';

export interface TailscaleClient {
  getStatus(): Promise<TailscaleStatus>;
  /** Starts (or resumes) the connection. `loginServer` empty/undefined targets Tailscale's own
   *  coordination server; a URL targets a self-hosted Headscale instance. Resolves once either an
   *  auth URL has been captured from `tailscale up`'s output, or the command finished on its own
   *  (already-authenticated case) - never waits for the user to actually finish the browser flow. */
  login(loginServer?: string): Promise<TailscaleLoginResult>;
  logout(): Promise<void>;
  setOptions(options: TailscaleSetOptions): Promise<void>;
}
