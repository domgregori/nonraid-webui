import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { authApi } from '../api/authApi';
import { setUnauthorizedHandler } from '../api/request';
import { AuthContext, type AuthLoadState, type LoginOutcome } from './AuthContext';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [configured, setConfigured] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [loadState, setLoadState] = useState<AuthLoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await authApi.status();
      if (!mounted.current) return;
      setConfigured(s.configured);
      setAuthenticated(s.authenticated);
      setLoadState('ready');
      setError(null);
    } catch (err) {
      if (!mounted.current) return;
      setLoadState('error');
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    refreshStatus();
    return () => {
      mounted.current = false;
    };
  }, [refreshStatus]);

  // Any 401 from anywhere in the app (session expired mid-use, revoked by a
  // password change in another tab, ...) bounces straight back to the login
  // screen instead of leaving whatever page was open stuck in a broken
  // error state.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (!mounted.current) return;
      setAuthenticated(false);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const setup = useCallback(async (username: string, password: string) => {
    const s = await authApi.setup(username, password);
    setConfigured(s.configured);
    setAuthenticated(s.authenticated);
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<LoginOutcome> => {
    const s = await authApi.login(username, password);
    setConfigured(s.configured);
    setAuthenticated(s.authenticated);
    if (s.twoFactorRequired) {
      return { ok: false, twoFactorRequired: true, methods: s.twoFactorMethods ?? [] };
    }
    return { ok: true };
  }, []);

  const logout = useCallback(async () => {
    const s = await authApi.logout();
    setConfigured(s.configured);
    setAuthenticated(s.authenticated);
  }, []);

  return (
    <AuthContext.Provider
      value={{ configured, authenticated, loadState, error, setup, login, logout, completeTwoFactor: refreshStatus, refreshStatus }}
    >
      {children}
    </AuthContext.Provider>
  );
}
