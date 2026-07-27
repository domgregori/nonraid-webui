import { useContext } from 'react';
import { AppStoreContext, type AppStoreContextValue } from './AppStoreContext';

export function useAppStore(): AppStoreContextValue {
  const ctx = useContext(AppStoreContext);
  if (!ctx) throw new Error('useAppStore must be used within an AppStoreProvider');
  return ctx;
}
