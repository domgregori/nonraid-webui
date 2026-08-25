# src/components/settings/

## Responsibility

The Settings page's sections and the backup/restore/import wizards. Each section owns its feature end-to-end (fetch, toggle, save, live status).

## Design

- Section components are self-contained: `RemoteBackupSection` (rclone remotes + sync jobs, 3s polling, `JobCard`/`JobEditor` internal components, encryption/retention/schedule fields), `TailscaleSection` (enable, login with auth-URL poll, hostname/SSH/DNS/routes toggles), `TlsSection` (self-signed generate, cert/key import with preview, http<->https origin redirect), `ServicesSection` (start/stop/restart with webui-reconnect polling and a `ReloadDriverPrompt` driver row), `LogsSection` (journalctl viewer gated on tab `active`, live tail with `since` cursor), `TwoFactorSection` (TOTP enroll scan/backup-codes, regenerate, Disable2faDialog), `PasskeySection` (WebAuthn registration via `@simplewebauthn/browser`, RemovePasskeyDialog).
- Shared form primitives: `AddRemoteForm` (provider picker + dynamic fields + OAuth `authUrl`-then-Continue dance, reused by onboarding), `ScheduleFields` (daily/weekly/monthly/cron, honors 12h/24h), `NotificationEventToggles` (catalog-driven Apprise/Webui per-event checkboxes via `RoundCheckbox`), `StorageLocationField` (Docker/LXC data-root migration with streamed progress).
- Wizards are staged flows: `ImportArrayWizard` (upload/locate-on-host -> review disk matches -> confirm -> result; size mismatches hard-block), `ConfigRestoreWizard` (upload -> review categories -> confirm -> result, with password prompt, array-superblock skip logic, and one-click restart services + `getStats()` reconnect polling), `RestoreFromLocalWizard`/`RestoreFromRemoteWizard` (source-picker front-ends that hand a fetched preview to `ConfigRestoreWizard` via `initialPreview`).

## Flow

`SettingsPage` mounts sections per tab (kept mounted, hidden via CSS, hence `LogsSection`'s `active` prop). Wizards fire `onRestored`/`onImported` exactly once on commit; `ConfigRestoreWizard` handles the expected mid-response connection drop when restarting the backend itself.

## Integration

Mounted from `SettingsPage`; `ImportArrayWizard`, `ConfigRestoreWizard`, `RestoreFromLocalWizard`, and `AddRemoteForm` are also mounted by `onboarding/OnboardingWizard`/`RemoteRestoreOnboarding`. Uses `settingsApi`, `rcloneApi`, `tailscaleApi`, `tlsApi`, `servicesApi`, `logsApi`, `authApi`, `systemApi`, `nmdApi`, plus shared `ToggleSwitch`, `RoundCheckbox`, `PathAutocomplete`, `ReloadDriverPrompt`, `ProgressBar`. Styling in `src/styles/settings.css`.
