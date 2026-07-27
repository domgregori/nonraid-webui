export interface SmartClient {
  readonly mode: 'real' | 'mock';
  /** Celsius, or null if unavailable (device asleep, permission denied, no temp sensor, etc). */
  getTemperature(device: string): Promise<number | null>;
}
