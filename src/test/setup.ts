import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
// Initializes react-i18next with the real English resources so components that call t()
// render actual copy in tests, matching production - without this, useTranslation()'s t()
// has no initialized i18n instance to read from and falls back to returning the raw key.
import '../i18n/config';

// Vitest runs without globals, so @testing-library/react's auto-cleanup (which hooks a
// global afterEach) never registers. Without this, DOM from earlier renders accumulates
// and later queries in a file see duplicate elements.
afterEach(() => {
  cleanup();
});
