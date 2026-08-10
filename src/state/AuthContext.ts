import { createContext } from 'react';
import type { TwoFactorMethod } from '../types/authApi';

export type AuthLoadState = 'loading' | 'ready' | 'error';

// login() returns this instead of throwing when a second factor is needed — that's an expected
// step in the flow, not a failure, unlike a genuinely wrong password (which still throws).
export type LoginOutcome = { ok: true } | { ok: false; twoFactorRequired: true; methods: TwoFactorMethod[] };

export interface AuthContextValue {
  configured: boolean;
  authenticated: boolean;
  loadState: AuthLoadState;
  /** Backend unreachable while checking status — distinct from "not logged in". */
  error: string | null;
  /** Each throws on a real failure — SetupPage/LoginPage catch locally and show
   *  their own error, matching every other form in this app (e.g. SettingsPage). */
  setup: (username: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<LoginOutcome>;
  logout: () => Promise<void>;
  /** Re-checks /auth/status and updates context state — used to finish the login flow after a
   *  second factor has been verified server-side and a real session cookie issued. */
  completeTwoFactor: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
