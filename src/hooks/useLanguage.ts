import { useCallback, useEffect, useState } from 'react';
import i18n from '../i18n/config';

export interface SupportedLanguage {
  code: string;
  label: string;
}

// Only English ships today - this list is what the Settings > Language dropdown
// renders, so adding a language later is just adding an entry here plus a
// `resources.<code>` block in i18n/config.ts.
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [{ code: 'en', label: 'English' }];

const STORAGE_KEY = 'nonraid-language-preference';

function readStored(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v && SUPPORTED_LANGUAGES.some((l) => l.code === v)) return v;
  } catch {
    // localStorage unavailable (private browsing, etc.) - fall back to default
  }
  return 'en';
}

/**
 * Pure client-side preference, same shape as useTheme() - no backend round-trip,
 * since this is about how one browser wants to see the app.
 */
export function useLanguage() {
  const [language, setLanguageState] = useState<string>(readStored);

  useEffect(() => {
    i18n.changeLanguage(language);
  }, [language]);

  const setLanguage = useCallback((next: string) => {
    setLanguageState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // best-effort - the in-memory state still applies for this page load
    }
  }, []);

  return { language, setLanguage };
}
