import { useContext } from 'react';
import { SettingsContext, type SettingsContextValue } from '../state/SettingsContext';

export type { SettingsLoadState } from '../state/SettingsContext';
export type UseSettings = SettingsContextValue;

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within a SettingsProvider');
  return ctx;
}
