// Single admin account, persisted to auth.json — see store.ts's doc comment.
export interface AuthRecord {
  username: string;
  passwordHash: string; // "saltHex:hashHex", see crypto.ts
  sessionSecret: string; // hex, HMAC key for signing session cookies
}

// The signed payload carried by the session cookie itself — no server-side
// session table, see crypto.ts's doc comment for why.
export interface SessionPayload {
  issuedAt: number;
  expiresAt: number;
}

export interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
}
