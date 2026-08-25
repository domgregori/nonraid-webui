# tools/config/

## Responsibility
Static configuration templates installed onto the host by `install-webui.sh` — the app's runtime config surface, its Samba baseline, and its Avahi/mDNS discovery advertisement.

## Design
- `nonraid-webui.toml.example` — annotated sample config (installed as `/etc/nonraid/config.toml`). Every key is commented out, meaning "built-in default"; `serve_frontend = true` + `frontend_dist_path` are the production-relevant ones. Read by `backend/src/config.ts` (env > TOML > default precedence).
- `smb.conf` — minimal Samba baseline that replaces the distro sample (which ships `[homes]`/`[printers]`/`[print$]` noise). `[global]` carries only what the app's SMB feature needs: `unix password sync` (Samba/Unix password sync), `map to guest = bad user`, and throughput tuning (sendfile/aio/receivefile/socket options/multichannel). Contains an empty `# === nonraid-webui:managed-shares:begin/end ===` marker block; the backend's `ShareApplier` rewrites only that block on every share change.
- `avahi-samba.service` — Avahi service-type XML advertising `_smb._tcp` on port 445 with `%h` → hostname, so shares appear in Finder/GNOME Files as `<hostname>.local`. Installed to `/etc/avahi/services/samba.service`.

## Flow
`install-webui.sh` copies each file to its host location (`/etc/nonraid/config.toml`, `/etc/samba/smb.conf`, `/etc/avahi/services/samba.service`). At runtime the backend reads `config.toml` for settings and edits only the managed block inside `smb.conf`.

## Integration
- `nonraid-webui.toml.example` ↔ `backend/src/config.ts`.
- `smb.conf` managed block ↔ `backend/src/shares/applier/realApplier.ts`.
- `avahi-samba.service` ↔ Avahi daemon for network discovery (no backend involvement after install).
