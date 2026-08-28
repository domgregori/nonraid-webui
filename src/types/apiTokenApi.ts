// Mirrors backend/src/auth/types.ts's ApiToken (minus `hash`, which never leaves the server) plus
// routes/auth.ts's POST /auth/tokens response shape. Keep in sync.
export interface ApiTokenEntry {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface CreatedApiToken extends Pick<ApiTokenEntry, 'id' | 'name' | 'createdAt'> {
  /** The raw bearer token (`nrd_...`) - returned exactly once, at creation time. Never persisted
   *  or retrievable again; only a hash of it lives server-side after this response. */
  token: string;
}
