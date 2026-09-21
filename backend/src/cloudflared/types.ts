// Mirrors the small slice of `cloudflared`/systemd state this app actually reads - unlike
// Tailscale, cloudflared (run in "tunnel run --token" mode, the dashboard-managed token flow) has
// no equivalent local `status --json` covering the tunnel's own live connection state; `running`
// here is the systemd unit's own active/inactive state, not a live handshake check against
// Cloudflare's edge.
export interface CloudflaredStatus {
  installed: boolean; // false when the `cloudflared` binary itself isn't on PATH
  version: string | null; // null when not installed
  running: boolean; // cloudflared-tunnel.service is active
  hasToken: boolean; // a tunnel token has been saved (see tokenStore.ts) - independent of `running`
}
