import type { Request } from 'express';

// The bits of an inbound request that cookie-secure/webauthn-config derivation need. `secure` and
// `hostname` are Express's own proxy-aware getters - they already read X-Forwarded-Proto/Host
// instead of the raw socket/Host header once config.trustProxy has set 'trust proxy' (see
// index.ts), and fall back to the raw connection otherwise. A plain object, not the full Request,
// so cookies.ts/webauthn.ts don't need an Express dependency just to consume it.
export interface RequestOrigin {
  secure: boolean;
  hostname: string;
}

export function requestOrigin(req: Request): RequestOrigin {
  return { secure: req.secure, hostname: req.hostname };
}
