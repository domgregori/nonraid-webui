import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import type { SelfTestHistoryEntry, SelfTestStatus, SelfTestType, SmartAttributes, SmartClient, SmartHealth } from './types.js';

const execFileAsync = promisify(execFile);

interface SmartctlAtaAttribute {
  id?: number;
  name?: string;
  raw?: { value?: number };
}

interface SmartctlSelfTestLogEntry {
  type?: { string?: string };
  status?: { string?: string; passed?: boolean };
  lifetime_hours?: number;
}

interface SmartctlJson {
  model_name?: string;
  serial_number?: string;
  user_capacity?: { bytes?: number };
  temperature?: { current?: number };
  nvme_smart_health_information_log?: { temperature?: number; power_on_hours?: number; power_cycles?: number };
  power_on_time?: { hours?: number };
  power_cycle_count?: number;
  ata_smart_attributes?: { table?: SmartctlAtaAttribute[] };
  ata_smart_data?: {
    capabilities?: {
      exec_offline_immediate_supported?: boolean;
      conveyance_self_test_supported?: boolean;
    };
    self_test?: {
      status?: { passed?: boolean; string?: string };
    };
  };
  ata_smart_self_test_log?: { standard?: { table?: SmartctlSelfTestLogEntry[] } };
  nvme_self_test_log?: {
    current_self_test_operation?: { string?: string };
    table?: Array<{ self_test_result?: { string?: string }; power_on_hours?: number }>;
  };
  smart_status?: { passed?: boolean };
}

// ATA SMART attribute IDs — same well-known numbering across drive vendors.
const ATTR_ID_REALLOCATED_SECTOR_CT = 5;
const ATTR_ID_POWER_ON_HOURS = 9;
const ATTR_ID_POWER_CYCLE_COUNT = 12;
const ATTR_ID_CURRENT_PENDING_SECTOR = 197;
const ATTR_ID_OFFLINE_UNCORRECTABLE = 198;

function findAttr(data: SmartctlJson, id: number): number | null {
  const attr = data.ata_smart_attributes?.table?.find((a) => a.id === id);
  return typeof attr?.raw?.value === 'number' ? attr.raw.value : null;
}

/**
 * Best-effort — smartmontools' JSON field names here are from general
 * knowledge, not confirmed against real `smartctl --json -a` output (see the
 * Disks tab handoff: no SMART-capable disk exists in this project's dev
 * environment). Every field falls back to null/unknown rather than throwing,
 * so an unexpected shape degrades to "—" in the UI instead of breaking it.
 */
function extractSelfTest(data: SmartctlJson): SelfTestStatus {
  const ataStatus = data.ata_smart_data?.self_test?.status;
  if (ataStatus) {
    const text = ataStatus.string ?? '';
    if (/progress/i.test(text)) {
      const match = text.match(/(\d+)%\s+of test remaining/i);
      const remainingPct = match ? Number(match[1]) : null;
      return {
        state: 'running',
        type: null, // smartctl's in-progress status text doesn't say which test type is running
        progressPct: remainingPct !== null ? 100 - remainingPct : null,
        statusText: text || 'Self-test in progress',
      };
    }
    if (typeof ataStatus.passed === 'boolean') {
      return { state: ataStatus.passed ? 'passed' : 'failed', type: null, progressPct: null, statusText: text || null };
    }
    return { state: 'unknown', type: null, progressPct: null, statusText: text || null };
  }

  const nvmeOp = data.nvme_self_test_log?.current_self_test_operation?.string;
  if (nvmeOp && !/no self-test/i.test(nvmeOp)) {
    return { state: 'running', type: null, progressPct: null, statusText: nvmeOp };
  }

  return { state: 'idle', type: null, progressPct: null, statusText: null };
}

function extractSelfTestHistory(data: SmartctlJson): SelfTestHistoryEntry[] {
  const ataTable = data.ata_smart_self_test_log?.standard?.table;
  if (ataTable) {
    return ataTable.map((entry) => ({
      type: entry.type?.string ?? 'Unknown',
      status: entry.status?.string ?? 'Unknown',
      passed: typeof entry.status?.passed === 'boolean' ? entry.status.passed : null,
      lifetimeHours: typeof entry.lifetime_hours === 'number' ? entry.lifetime_hours : null,
    }));
  }

  const nvmeTable = data.nvme_self_test_log?.table;
  if (nvmeTable) {
    return nvmeTable.map((entry) => ({
      type: 'self-test',
      status: entry.self_test_result?.string ?? 'Unknown',
      passed: entry.self_test_result?.string ? /pass|complet/i.test(entry.self_test_result.string) : null,
      lifetimeHours: typeof entry.power_on_hours === 'number' ? entry.power_on_hours : null,
    }));
  }

  return [];
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

  async getAttributes(device: string): Promise<SmartAttributes | null> {
    let data: SmartctlJson;
    try {
      data = await this.run(device);
    } catch {
      return null;
    }
    if (typeof data.smart_status?.passed !== 'boolean' && !data.ata_smart_attributes && !data.nvme_smart_health_information_log) {
      return null; // no SMART data at all — e.g. a virtio-blk device with no pass-through
    }

    const caps = data.ata_smart_data?.capabilities;
    return {
      device,
      model: data.model_name ?? null,
      serial: data.serial_number ?? null,
      capacityBytes: data.user_capacity?.bytes ?? null,
      health: typeof data.smart_status?.passed === 'boolean' ? (data.smart_status.passed ? 'passed' : 'failed') : null,
      temperature: extractTemperatureC(data),
      powerOnHours: data.power_on_time?.hours ?? data.nvme_smart_health_information_log?.power_on_hours ?? findAttr(data, ATTR_ID_POWER_ON_HOURS),
      powerCycleCount: data.power_cycle_count ?? data.nvme_smart_health_information_log?.power_cycles ?? findAttr(data, ATTR_ID_POWER_CYCLE_COUNT),
      reallocatedSectors: findAttr(data, ATTR_ID_REALLOCATED_SECTOR_CT),
      pendingSectors: findAttr(data, ATTR_ID_CURRENT_PENDING_SECTOR),
      uncorrectableSectors: findAttr(data, ATTR_ID_OFFLINE_UNCORRECTABLE),
      selfTest: extractSelfTest(data),
      selfTestHistory: extractSelfTestHistory(data),
      capabilities: {
        // Any ATA/NVMe drive with SMART data supports a short and long test; conveyance is ATA-only and optional.
        short: true,
        long: true,
        conveyance: caps?.conveyance_self_test_supported === true,
      },
    };
  }

  async startSelfTest(device: string, type: SelfTestType): Promise<void> {
    const args = ['-t', type, device];
    const bin = config.smartUseSudo ? 'sudo' : config.smartctlBin;
    const fullArgs = config.smartUseSudo ? [config.smartctlBin, ...args] : args;
    try {
      // smartctl returns immediately once the drive's controller has accepted the test — see types.ts's doc comment.
      await execFileAsync(bin, fullArgs, { timeout: config.smartTimeoutMs, maxBuffer: 4 * 1024 * 1024 });
    } catch (err) {
      // Same bitmask-exit-code caveat as run() above: smartctl -t can exit
      // nonzero (e.g. "previous self-test still in progress") while still
      // having done nothing harmful — surface it as a real error either way,
      // since unlike a passive read there's no JSON payload to fall back to.
      throw new Error(`smartctl -t ${type} failed: ${(err as Error).message}`);
    }
  }
}
