import { browserSupportsWebAuthn } from '@simplewebauthn/browser';

// Browsers refuse the WebAuthn ceremony outside a secure context — HTTPS, or the literal
// "localhost" origin (a standard carve-out browsers grant to local development). This app is
// normally reached over plain http://<lan-hostname>:3001, which fails this check; only an
// HTTPS-fronted deployment (or an ssh -L tunnel to localhost) can actually complete a passkey
// ceremony. browserSupportsWebAuthn() alone isn't enough — it only checks that the API exists, not
// that the current page is allowed to call it.
export function webauthnAvailable(): boolean {
  return browserSupportsWebAuthn() && (window.location.protocol === 'https:' || window.location.hostname === 'localhost');
}
