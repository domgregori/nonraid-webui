// Mirrors backend/src/tailscale/types.ts plus routes/tailscale.ts's status payload shape (which
// adds featureEnabled/loginServer from settings.json on top of the live client status). Keep in
// sync.
export type TailscaleBackendState = 'NoState' | 'NeedsLogin' | 'NeedsMachineAuth' | 'Stopped' | 'Starting' | 'Running';

export interface TailscaleStatus {
  installed: boolean;
  backendState: TailscaleBackendState | null;
  loggedIn: boolean;
  hostname: string | null;
  dnsName: string | null;
  tailscaleIps: string[];
  tailnetName: string | null;
  ssh: boolean;
  acceptDns: boolean;
  advertiseRoutes: string[];
  acceptRoutes: boolean;
  featureEnabled: boolean;
  loginServer: string;
}

export interface TailscaleLoginResult {
  authUrl: string | null;
}

export interface TailscaleSetOptions {
  hostname?: string;
  ssh?: boolean;
  acceptDns?: boolean;
  advertiseRoutes?: string[];
  acceptRoutes?: boolean;
}
