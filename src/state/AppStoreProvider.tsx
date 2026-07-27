import { useReducer, type ReactNode } from 'react';
import { appReducer, initialAppState } from './appReducer';
import { AppStoreContext } from './AppStoreContext';

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialAppState);
  return <AppStoreContext.Provider value={{ state, dispatch }}>{children}</AppStoreContext.Provider>;
}
