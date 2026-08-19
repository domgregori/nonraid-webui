import { API_BASE_URL } from './config';

export class UnauthorizedError extends Error {}

/** Set on the thrown Error when the response body carries a `code` field - generic, so any
 *  endpoint's caller can key off a stable code instead of matching the human-readable message. */
export class CodedError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

// AuthProvider registers/unregisters this on mount/unmount - the single
// place every 401 (login expired, session revoked by a password change
// elsewhere, etc.) routes back to the login screen, since every API call in
// this app goes through this one function.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, credentials: 'include' });
  if (res.status === 401) {
    onUnauthorized?.();
    throw new UnauthorizedError('Unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = body?.error ?? `Request failed: ${res.status}`;
    throw body?.code ? new CodedError(message, body.code) : new Error(message);
  }
  return res.json() as Promise<T>;
}
