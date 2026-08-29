// Mirrors backend/src/auth/types.ts's ApiToken (minus `hash`, which never leaves the server) plus
// routes/auth.ts's POST /auth/tokens response shape. Keep in sync.

// 'read-only' gets a 403 on any non-GET/HEAD/OPTIONS request - see ApiTokenScope's doc comment in
// backend/src/auth/types.ts for why this is a blanket verb-based rule, not a per-route allowlist.
export type ApiTokenScope = 'full' | 'read-only';

export interface ApiTokenEntry {
  id: string;
  name: string;
  scope: ApiTokenScope;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface CreatedApiToken extends Pick<ApiTokenEntry, 'id' | 'name' | 'scope' | 'createdAt'> {
  /** The raw bearer token (`nrd_...`) - returned exactly once, at creation time. Never persisted
   *  or retrievable again; only a hash of it lives server-side after this response. */
  token: string;
}
