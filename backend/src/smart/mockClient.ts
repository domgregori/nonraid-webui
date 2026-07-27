import { mockDeviceTemps } from '../nmd/mockData.js';
import type { SmartClient } from './types.js';

export class MockSmartClient implements SmartClient {
  readonly mode = 'mock' as const;
  private baseline = mockDeviceTemps();

  async getTemperature(device: string): Promise<number | null> {
    const base = this.baseline[device];
    if (base === undefined) return null;
    // small jitter so it reads as a live sensor rather than a static fixture
    return Math.round((base + (Math.random() * 2 - 1)) * 10) / 10;
  }
}
