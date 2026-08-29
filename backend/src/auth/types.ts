// Single admin account, persisted to auth.json - see store.ts's doc comment.
export interface AuthRecord {
  username: string;
  passwordHash: string; // "saltHex:hashHex", see crypto.ts
  sessionSecret: string; // hex, HMAC key for signing session cookies
  totp?: TotpConfig;
  // Kept separate from `totp` so an unconfirmed enrollment (secret generated, QR shown, but the
  // user hasn't yet proven they can produce a real code from it) is never mistaken for an active
  // one - nothing that decides whether 2FA is required at login reads this field, only `totp`.
  pendingTotp?: PendingTotpEnrollment;
  passkeys?: PasskeyCredential[];
  apiTokens?: ApiToken[];
}

// 'full' behaves exactly like a session cookie. 'read-only' is enforced by HTTP method, not a
// per-route allowlist (see middleware.ts's requireAuth): GET/HEAD pass, everything else gets a
// 403. A blanket verb-based rule rather than modeling every route's real semantics - this whole
// app already follows REST conventions closely enough (see backend/API.md) that "non-GET =
// mutation" holds almost everywhere, and the failure mode of getting it wrong (a 403 on a route
// that was actually harmless) is a nuisance, not a security hole, unlike the reverse.
export type ApiTokenScope = 'full' | 'read-only';

// A long-lived credential for the CLI (or any other non-browser client) to authenticate without a
// session cookie - sent as `Authorization: Bearer <raw token>`. Only ever mintable/revocable by
// someone already holding a real session cookie (see routes/auth.ts's token routes and
// requireSession) - never by another token - so there's no bootstrapping problem where a leaked
// token could mint further tokens for itself.
export interface ApiToken {
  id: string;
  name: string; // user-supplied label, e.g. "laptop cli"
  hash: string; // "saltHex:hashHex" of the raw token, same scrypt format as passwordHash - see
  // crypto.ts. The raw token itself is never stored, only shown once at creation time.
  scope: ApiTokenScope;
  createdAt: number;
  lastUsedAt: number | null;
}

// secret is stored in the clear (base32), unlike passwordHash/backup-code hashes below - the
// server must be able to *compute* a code to compare against, not just verify a hash of one.
// Standard TOTP practice, not an oversight.
export interface TotpConfig {
  secret: string;
  confirmedAt: number;
  backupCodes: TotpBackupCode[];
}

export interface TotpBackupCode {
  hash: string; // "saltHex:hashHex", same scrypt format as passwordHash - see crypto.ts
  usedAt: number | null;
}

export interface PendingTotpEnrollment {
  secret: string;
  createdAt: number;
}

export interface PasskeyCredential {
  id: string; // credential ID, base64url
  publicKey: string; // base64url-encoded COSE public key
  counter: number; // WebAuthn signature counter - anti-clone signal, bumped on every use
  transports?: string[];
  name: string; // user-supplied friendly name, e.g. "YubiKey"
  createdAt: number;
}

// The signed payload carried by the session cookie itself - no server-side session table, see
// crypto.ts's doc comment for why. `purpose` is a required discriminator, not decoration: without
// it, this shape is indistinguishable from TwoFactorPendingPayload below once both are signed with
// the same account secret, and a pending-2FA cookie could be replayed as a real session - see
// crypto.ts's signPayload/verifyPayload doc comment for the full reasoning.
export interface SessionPayload {
  purpose: 'session';
  issuedAt: number;
  expiresAt: number;
}

// Issued after a correct password but before the second factor is verified - deliberately signed
// with the same account sessionSecret (keeps this stateless, no new secret to manage), but never
// accepted by verifySession() because of the purpose discriminator above.
export interface TwoFactorPendingPayload {
  purpose: 'twofactor_pending';
  issuedAt: number;
  expiresAt: number;
}

export type TwoFactorMethod = 'totp' | 'passkey';

export interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
}
