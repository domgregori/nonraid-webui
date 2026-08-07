import { createContext } from 'react';

export type AuthLoadState = 'loading' | 'ready' | 'error';

export interface AuthContextValue {
  configured: boolean;
  authenticated: boolean;
  loadState: AuthLoadState;
  /** Backend unreachable while checking status — distinct from "not logged in". */
  error: string | null;
  /** Each throws on failure — SetupPage/LoginPage catch locally and show
   *  their own error, matching every other form in this app (e.g. SettingsPage). */
  setup: (username: string, password: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
