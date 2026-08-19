import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { settingsApi } from '../api/settingsApi';
import type { AppSettings, AppSettingsUpdate } from '../types/settingsApi';
import { SettingsContext, type SettingsLoadState } from './SettingsContext';

/** Single fetch-once-then-shared source of truth for persisted app settings - was a plain
 *  fetch-on-mount hook used only by SettingsPage, but HeaderClock also needs to read timeFormat
 *  live, and a second independent hook instance wouldn't see an update() made through the other
 *  one until its own next mount (e.g. a full page reload). A shared context fixes that: every
 *  consumer reads the same state, and it updates everywhere the moment update() resolves. */
export function SettingsProvider({ children }: { children: ReactNode }) {
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

  return <SettingsContext.Provider value={{ settings, loadState, error, saving, saveError, update }}>{children}</SettingsContext.Provider>;
}
