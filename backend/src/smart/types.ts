export type SmartHealth = 'passed' | 'failed';

export interface SmartClient {
  readonly mode: 'real' | 'mock';
  /** Celsius, or null if unavailable (device asleep, permission denied, no temp sensor, etc). */
  getTemperature(device: string): Promise<number | null>;
  /** Overall SMART health self-assessment, or null if unavailable (device asleep, no SMART support, etc). */
  getHealth(device: string): Promise<SmartHealth | null>;
}
