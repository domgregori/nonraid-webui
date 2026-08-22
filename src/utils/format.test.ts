import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  formatBytesAsMB,
  formatBytesHuman,
  formatFileSize,
  formatUptime,
  formatMemLabel,
  formatRelativeTime,
} from './format';

const KB = 1024;
const MB = 1024 ** 2;
const GB = 1024 ** 3;
const TB = 1024 ** 4;

describe('formatBytesAsMB', () => {
  const cases: [number, string][] = [
    [0, '0 MB'],
    [MB, '1 MB'],
    [1.4 * MB, '1 MB'], // rounds down
    [1.5 * MB, '2 MB'], // rounds half up
    [2.6 * MB, '3 MB'], // rounds up
    [10.4 * MB, '10 MB'],
    [10.5 * MB, '11 MB'],
    [512 * MB, '512 MB'],
    [1024 * MB, '1024 MB'], // no TB rollover in this helper
  ];
  it.each(cases)('formatBytesAsMB(%d) -> %s', (bytes, expected) => {
    expect(formatBytesAsMB(bytes)).toBe(expected);
  });
});

describe('formatBytesHuman', () => {
  const cases: [number, string][] = [
    [0, '0.0 GB'],
    [5 * GB, '5.0 GB'], // sub-10 GB keeps one decimal
    [9.9 * GB, '9.9 GB'],
    [10 * GB, '10 GB'], // >= 10 GB rounds to integer
    [10.4 * GB, '10 GB'],
    [10.6 * GB, '11 GB'],
    [512 * GB, '512 GB'],
    [1023.9 * GB, '1024 GB'], // still GB branch, rounds to integer
    [TB, '1 TB'], // exact TB boundary flips to TB
    [1.5 * TB, '1.5 TB'], // sub-integer TB keeps one decimal
    [2 * TB, '2 TB'],
    [2.25 * TB, '2.3 TB'], // one-decimal rounding
    [1234 * TB, '1234 TB'], // no PB rollover in this helper
  ];
  it.each(cases)('formatBytesHuman(%d) -> %s', (bytes, expected) => {
    expect(formatBytesHuman(bytes)).toBe(expected);
  });
});

describe('formatFileSize', () => {
  const cases: [number, string][] = [
    [0, '0 B'],
    [1, '1 B'],
    [512, '512 B'],
    [1023, '1023 B'], // just under 1 KB
    [1024, '1.0 KB'], // exact 1 KB boundary
    [1536, '1.5 KB'],
    [9728, '9.5 KB'], // sub-10 value keeps one decimal
    [10 * KB, '10 KB'], // >= 10 rounds to integer
    [15 * KB, '15 KB'],
    [MB, '1.0 MB'],
    [9.5 * MB, '9.5 MB'],
    [10 * MB, '10 MB'],
    [GB, '1.0 GB'],
    [1.5 * GB, '1.5 GB'],
    [TB, '1.0 TB'],
    [1.5 * TB, '1.5 TB'],
    [1234 * TB, '1234 TB'], // beyond TB stays in TB
  ];
  it.each(cases)('formatFileSize(%d) -> %s', (bytes, expected) => {
    expect(formatFileSize(bytes)).toBe(expected);
  });
});

describe('formatUptime', () => {
  const cases: [number, string][] = [
    [0, '0m'],
    [30, '0m'],
    [59, '0m'], // just under a minute
    [60, '1m'], // exact minute boundary
    [599, '9m'],
    [600, '10m'],
    [3599, '59m'],
    [3600, '1h 0m'], // exact hour boundary
    [3661, '1h 1m'],
    [7199, '1h 59m'],
    [86399, '23h 59m'],
    [86400, '1d 0h'], // exact day boundary
    [90000, '1d 1h'],
    [172799, '1d 23h'],
    [172800, '2d 0h'],
    [279000, '3d 5h'], // seconds below the hour are dropped once days are shown
  ];
  it.each(cases)('formatUptime(%d) -> %s', (seconds, expected) => {
    expect(formatUptime(seconds)).toBe(expected);
  });
});

describe('formatMemLabel', () => {
  const cases: [number, number, string][] = [
    [0, 0, '0.0 / 0 GB'],
    [0, 4 * GB, '0.0 / 4 GB'],
    [GB, 4 * GB, '1.0 / 4 GB'],
    [1.5 * GB, 4 * GB, '1.5 / 4 GB'],
    [0.5 * GB, 8 * GB, '0.5 / 8 GB'],
    [2 * GB, 3.6 * GB, '2.0 / 4 GB'], // total rounds to integer
    [3 * GB, 8 * GB, '3.0 / 8 GB'],
  ];
  it.each(cases)('formatMemLabel(%d, %d) -> %s', (used, total, expected) => {
    expect(formatMemLabel(used, total)).toBe(expected);
  });
});

describe('formatRelativeTime', () => {
  const NOW = new Date('2026-08-22T12:00:00Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-22T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const cases: [number, string][] = [
    [NOW, 'just now'],
    [NOW - 30_000, 'just now'],
    [NOW - 59_000, 'just now'], // just under a minute
    [NOW - 60_000, '1m ago'], // exact minute boundary
    [NOW - 5 * 60_000, '5m ago'],
    [NOW - 59 * 60_000, '59m ago'],
    [NOW - 60 * 60_000, '1h ago'], // exact hour boundary
    [NOW - 5 * 3_600_000, '5h ago'],
    [NOW - 23 * 3_600_000, '23h ago'],
    [NOW - 24 * 3_600_000, '1d ago'], // exact day boundary
    [NOW - 2 * 86_400_000, '2d ago'],
    [NOW - 365 * 86_400_000, '365d ago'],
    [NOW + 5_000, 'just now'], // future timestamps clamp to zero
  ];
  it.each(cases)('formatRelativeTime(%d) -> %s', (timestamp, expected) => {
    expect(formatRelativeTime(timestamp)).toBe(expected);
  });
});
