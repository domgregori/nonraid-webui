# nonraid-tool

A command-line client for the nonraid-webui backend API. Runs as a plain CLI by default; `nonraid-tool tui` opens an interactive dashboard instead.

```bash
nonraid-tool --version   # or: nonraid-tool version, or: nonraid-tool -V
```

## Install

`nonraid-tool` is built and installed by the webui's own install script, as part of a normal install or update:

```bash
sudo bash tools/install-webui.sh
```

This puts a `nonraid-tool` command on `PATH` (a symlink to `cli/dist/index.js`). To rebuild and reinstall just the CLI later, without touching anything else:

```bash
sudo bash tools/install-webui.sh --step update_cli
```

For local development, run it straight from source:

```bash
cd cli
npm install
npm run dev -- <command>   # tsx, no build step
```

## Log in

```bash
nonraid-tool login
```

Prompts for the backend URL, username, and password (plus a 2FA code if enrolled), then mints a long-lived API token and saves it to `~/.config/nonraid-tool/config.json` (mode `0600`). Every later command reads that file automatically — no need to log in again.

Tokens have a scope: `login` mints a full-access one by default, or add `--read-only` for a token that can only run `GET`-style commands (`ls`, `status`, `info`, ...) — anything that starts, stops, or changes something gets rejected server-side. Handy for monitoring scripts that shouldn't be able to touch anything.

`nonraid-tool logout` forgets the token locally. Add `--revoke` to also invalidate it on the server (re-prompts for the password, since revoking a token needs a real session). Tokens can also be created (with either scope), listed, and revoked from the web UI: **Settings → Security → API tokens**.

Passkey-only accounts can't complete `login` from a terminal — enroll TOTP or a backup code as a fallback first.

## Environment variables

For scripting or CI, skip the saved config file entirely:

| Variable | Purpose |
|---|---|
| `NONRAID_HOST` | Backend URL, e.g. `http://nonraid.lan`. Overrides the saved config. |
| `NONRAID_TOKEN` | Bearer token. Overrides the saved config. |
| `NONRAID_INSECURE` | Set to `1` to skip TLS certificate verification (self-signed cert). |

These take priority over `~/.config/nonraid-tool/config.json` whenever set — there's no per-command `--host`/`--token` flag, only `login` itself takes `--host`.

## Commands

Every group has its own `--help` with the full, current flag list — this table is just a map, not the authoritative reference.

| Command | Covers |
|---|---|
| `array status / start / stop` | Array state, health, per-disk summary, lifecycle |
| `disk ls / spin-down / spin-up / smart / self-test` | Per-disk operations, including SMART attributes and self-tests |
| `parity status / start` | Parity check progress and control |
| `docker ls / start / stop` | Docker containers |
| `lxc ls / start / stop` | LXC containers |
| `share ls / create / update / rm` | Shares (pools) |
| `user ls / add / set / rm / access / grant` | Managed local users and their per-share access |
| `group ls / add / rm / access / grant` | Managed local groups and their per-share access |
| `system info / set-hostname / set-timezone / timezones / reboot / reload-driver / restart-services` | Host-level info and controls |
| `system backup run-now` | Run the configured scheduled backup on demand |
| `system snapshot ls / create / rm` | Read-only btrfs boot-disk snapshots |
| `service ls / start / stop / restart` | Managed systemd services (smb, nfs, docker, ...) |
| `smart temps / spin-states / health / disk-types / device` | SMART status across all array disks, or one unassigned/boot device |
| `activity` | The in-app activity feed |
| `logs sources / tail` | journalctl-backed system log sources |
| `metrics <names>` | Historical time-series metrics (comma-separated, e.g. `cpu_percent,mem_used_bytes`) |
| `cache status / setup / replace / replace-status / enable / disable` | Mirrored cache pool |
| `cache mover run / status / cancel` | Cache mover (moves cached files onto the array) |
| `rclone status / enable / disable / providers` | Remote Backup feature state, supported providers |
| `rclone remote ls / add / show / set / rm` | Configured rclone remotes (non-OAuth providers only) |
| `rclone job ls / create / update / rm / enable / disable / sync / cancel / backups` | Remote backup sync jobs |
| `decrypt-backup <archive>` | Decrypt a local `.nrb` config backup archive - a pure local file operation, no login/API access needed |

`decrypt-backup` is the odd one out in that table: it never talks to the backend at all, so it works with the webui down, the array stopped, or the archive opened on a completely different machine. Prompts for the password (masked) unless `NRB_PASSWORD` is set in the environment. Add `-x`/`--extract` to unpack straight into a directory instead of leaving a `.tar.gz`, or `-o`/`--output <path>` to control where it's written.

Examples:

```bash
nonraid-tool array status
nonraid-tool disk spin-down 3
nonraid-tool docker stop jellyfin
nonraid-tool share create media --disks 1,2,3 --protocols smb,nfs
nonraid-tool user grant alice media read-write
nonraid-tool metrics cpu_percent,mem_used_bytes --range 7d
nonraid-tool rclone job sync <id>   # id from `rclone job ls`, not the job's --name
nonraid-tool decrypt-backup nonraid-config-backup-1234567890.nrb
```

A few operations are disruptive or long-running by nature and worth knowing about before running them: `disk self-test` starts a real SMART test that can take hours; `system reboot` and `system set-hostname`/`set-timezone` affect the whole host; `cache setup`/`replace` reassign real disks.

## Interactive mode (TUI)

```bash
nonraid-tool tui
```

An Ink-based dashboard: array summary plus a selectable Docker/LXC container list. ↑/↓ to move the selection, `s` to start/stop it, `r` to refresh, `q` or Esc to quit. Everything else in the table above is plain-CLI only for now.

## Development

Same TypeScript/ESM conventions as the rest of this repo. New commands follow the existing `registerXCommand(program)` shape — see `src/commands/docker.ts` for the shortest example, `src/commands/array.ts` for one with several subcommands. `src/output.ts` (`runAction`/`printTable`) and `src/api/client.ts` (`ApiClient`) are the shared building blocks; don't reinvent either.

```bash
npx tsc -p tsconfig.json --noEmit   # typecheck
npx oxlint src/                     # lint
npm run build                       # build
```

See `backend/API.md` for the full backend route reference this CLI talks to.
