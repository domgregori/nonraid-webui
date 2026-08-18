import { createContext } from 'react';
import type { AppSettings, AppSettingsUpdate } from '../types/settingsApi';

export type SettingsLoadState = 'loading' | 'ready' | 'error';

export interface SettingsContextValue {
  settings: AppSettings | null;
  loadState: SettingsLoadState;
  error: string | null;
  saving: boolean;
  saveError: string | null;
  update: (patch: AppSettingsUpdate) => Promise<void>;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);
