import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import type { SmartClient, SmartHealth } from './types.js';

const execFileAsync = promisify(execFile);

interface SmartctlAtaAttribute {
  name?: string;
  raw?: { value?: number };
}

interface SmartctlJson {
  temperature?: { current?: number };
  nvme_smart_health_information_log?: { temperature?: number };
  ata_smart_attributes?: { table?: SmartctlAtaAttribute[] };
  smart_status?: { passed?: boolean };
}

/**
 * Extracts temperature (Celsius) from smartctl's --json output. smartmontools
 * normalizes most device types under `temperature.current` since ~7.0, but we
 * fall back to the NVMe-specific and ATA-attribute-table paths for older
 * versions or devices where the normalized field is missing.
 */
function extractTemperatureC(data: SmartctlJson): number | null {
  if (typeof data.temperature?.current === 'number') return data.temperature.current;
  if (typeof data.nvme_smart_health_information_log?.temperature === 'number') {
    return data.nvme_smart_health_information_log.temperature;
  }
  const attr = data.ata_smart_attributes?.table?.find((a) => a.name === 'Temperature_Celsius' || a.name === 'Airflow_Temperature_Cel');
  if (typeof attr?.raw?.value === 'number') return attr.raw.value;
  return null;
}

export class RealSmartClient implements SmartClient {
  readonly mode = 'real' as const;

  private async run(device: string): Promise<SmartctlJson> {
    // -n standby: don't spin up a sleeping disk just to check its temperature.
    const args = ['-n', 'standby', '--json', '-a', device];
    const bin = config.smartUseSudo ? 'sudo' : config.smartctlBin;
    const fullArgs = config.smartUseSudo ? [config.smartctlBin, ...args] : args;

    try {
      const { stdout } = await execFileAsync(bin, fullArgs, { timeout: config.smartTimeoutMs, maxBuffer: 4 * 1024 * 1024 });
      return JSON.parse(stdout) as SmartctlJson;
    } catch (err) {
      // smartctl's exit code is a bitmask of conditions (device asleep, SMART
      // check failed, etc) — nonzero doesn't mean the JSON on stdout is bad.
      const stdout = (err as { stdout?: string }).stdout;
      if (stdout) {
        try {
          return JSON.parse(stdout) as SmartctlJson;
        } catch {
          // fall through to rethrow below
        }
      }
      throw err;
    }
  }

  async getTemperature(device: string): Promise<number | null> {
    try {
      const data = await this.run(device);
      return extractTemperatureC(data);
    } catch {
      return null;
    }
  }

  async getHealth(device: string): Promise<SmartHealth | null> {
    try {
      const data = await this.run(device);
      if (typeof data.smart_status?.passed !== 'boolean') return null;
      return data.smart_status.passed ? 'passed' : 'failed';
    } catch {
      return null;
    }
  }
}
