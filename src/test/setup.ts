import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Vitest runs without globals, so @testing-library/react's auto-cleanup (which hooks a
// global afterEach) never registers. Without this, DOM from earlier renders accumulates
// and later queries in a file see duplicate elements.
afterEach(() => {
  cleanup();
});
