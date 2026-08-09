import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'nonraid-theme-preference';

function readStored(): ThemePreference {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    // localStorage unavailable (private browsing, etc.) — fall back to system
  }
  return 'system';
}

function apply(preference: ThemePreference): void {
  if (preference === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', preference);
  }
}

/**
 * Pure client-side preference — no backend round-trip, since this is about
 * how one browser wants to see the app, not shared server state. index.html
 * has a small blocking inline script that applies the stored preference
 * before first paint (avoids a flash of the wrong theme); this hook's own
 * effect re-applies it too, both as a safety net and to react to changes
 * made through the Appearance card.
 */
export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStored);

  useEffect(() => {
    apply(preference);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    try {
      if (next === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // best-effort — the in-memory state still applies for this page load
    }
  }, []);

  return { preference, setPreference };
}
