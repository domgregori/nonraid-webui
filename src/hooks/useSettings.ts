import { useCallback, useEffect, useRef, useState } from 'react';
import { settingsApi } from '../api/settingsApi';
import type { AppSettings, AppSettingsUpdate } from '../types/settingsApi';

export type SettingsLoadState = 'loading' | 'ready' | 'error';

export interface UseSettings {
  settings: AppSettings | null;
  loadState: SettingsLoadState;
  error: string | null;
  saving: boolean;
  saveError: string | null;
  update: (patch: AppSettingsUpdate) => Promise<void>;
}

/** Single source of truth for persisted app settings, used by SettingsPage. */
export function useSettings(): UseSettings {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loadState, setLoadState] = useState<SettingsLoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const result = await settingsApi.getSettings();
      if (!mounted.current) return;
      setSettings(result);
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
    refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const update = useCallback(async (patch: AppSettingsUpdate) => {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await settingsApi.updateSettings(patch);
      if (!mounted.current) return;
      setSettings(result);
    } catch (err) {
      if (!mounted.current) return;
      setSaveError((err as Error).message);
    } finally {
      if (mounted.current) setSaving(false);
    }
  }, []);

  return { settings, loadState, error, saving, saveError, update };
}
