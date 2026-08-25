# src/utils/

## Responsibility
Framework-free pure helpers shared across the app: byte/size/time formatting and WebAuthn capability detection.

## Design
- `format.ts` exports pure functions with no imports or side effects:
  - `formatBytesAsMB` (MB integer), `formatBytesHuman` (GB below 1024 else TB, matching disk sizes elsewhere), `formatFileSize` (B→TB for file listings), `formatUptime` (`d h`, `h m`, `m`), `formatMemLabel` (`used / total GB`), `formatRelativeTime` (`just now` / `5m ago` / …).
- `webauthnSupport.ts` exports `webauthnAvailable()`: true only when `browserSupportsWebAuthn()` (from `@simplewebauthn/browser`) AND the page is a secure context (`https:` or `localhost`) — the plain `http://<lan-host>` origin the app normally runs on cannot complete a passkey ceremony.

## Flow
Imported directly at the point of use; called with a plain value and immediately returned to a string/boolean for rendering. No state, no React, no IO.

## Integration
- `format.ts` is used by selectors (`formatBytesAsMB` in `selectors/containers.ts`, `selectors/lxcContainers.ts`; `formatBytesHuman` in `selectors/shares.ts`) and pages/components (`BrowsePage` `formatFileSize`, `HistoryPage` `formatBytesHuman`, `SettingsPage` `formatMemLabel`/`formatUptime`).
- `webauthnSupport.ts` is used by the auth/2FA UI (`components/auth/TwoFactorStep`, `components/settings/PasskeySection`) to hide passkey options where they cannot work.
