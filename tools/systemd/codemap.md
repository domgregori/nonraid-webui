# tools/systemd/

## Responsibility
Systemd units that run the appliance at boot and keep it alive — the main webui service and the optional rclone remote-control daemon.

## Design
- `nonraid-webui.service` — runs the built backend (`node /opt/nonraid-webui/backend/dist/index.js`) with `Type=simple`, `Restart=on-failure` (5s), `WorkingDirectory=/var/lib/nonraid-webui` and `StateDirectory=nonraid-webui` (separating persistent state from the `/opt` code tree so updates never touch it). `After=network.target nonraid.service`. Runs as root (no `User=` override) — the backend shells out to nmdctl/Docker/LXC/mount/smbpasswd which all need root.
- `rclone-rcd.service` — loopback-only `rclone rcd` on `127.0.0.1:5572`, reading `RCLONE_RC_USER`/`RCLONE_RC_PASS` from `/etc/default/rclone-rcd` (EnvironmentFile). Enabled only when the Remote Backup feature is toggled on. The backend is the only intended client, authenticated against the same credential file.

## Flow
Install script installs both units; `nonraid-webui.service` is enabled+started, `rclone-rcd.service` is installed but left disabled until `PUT /rclone/enabled` (and `PUT /tailscale/enabled` for tailscaled) turns the feature on. The webui service is self-restartable (routes exit non-zero to trigger `Restart=on-failure`).

## Integration
- `nonraid-webui.service` ↔ `backend/src/index.ts` (the process), `tools/install-webui.sh` (installer), `backend/src/routes/tls.ts` + `routes/services.ts` (self-restart via non-zero exit).
- `rclone-rcd.service` ↔ `backend/src/rclone/realClient.ts` + `rcCredentials.ts` (shared `/etc/default/rclone-rcd`).
