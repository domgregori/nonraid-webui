// Mirrors the fields this app actually reads out of `tailscale status --json` - that command's
// real output has far more (Peer map, per-peer capabilities, etc.) than anything used here.
export type TailscaleBackendState = 'NoState' | 'NeedsLogin' | 'NeedsMachineAuth' | 'Stopped' | 'Starting' | 'Running';

export interface TailscaleStatus {
  installed: boolean; // false when the `tailscale` binary itself isn't on PATH
  backendState: TailscaleBackendState | null; // null when `installed` is false
  loggedIn: boolean; // backendState === 'Running'
  hostname: string | null;
  dnsName: string | null; // the full MagicDNS name, e.g. "nonraid.tailnet-name.ts.net."
  tailscaleIps: string[];
  tailnetName: string | null;
  ssh: boolean;
  acceptDns: boolean;
  advertiseRoutes: string[]; // CIDRs this node is advertising, whether or not they're approved yet
  acceptRoutes: boolean;
}

export interface TailscaleLoginResult {
  // Set when `tailscale up` needs the user to open a browser and finish auth - the frontend shows
  // this as a link (and should keep polling GET /tailscale/status until backendState flips to
  // Running). Absent when the node was already authenticated and `up` just succeeded outright.
  authUrl: string | null;
}

export interface TailscaleSetOptions {
  hostname?: string;
  ssh?: boolean;
  acceptDns?: boolean;
  advertiseRoutes?: string[]; // [] clears all advertised routes
  acceptRoutes?: boolean;
}
