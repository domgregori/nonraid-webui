import { API_BASE_URL } from './config';

export class UnauthorizedError extends Error {}

// AuthProvider registers/unregisters this on mount/unmount — the single
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
    throw new Error(body?.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}
