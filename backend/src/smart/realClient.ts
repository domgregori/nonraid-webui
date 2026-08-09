import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../config.js';
import type {
  SelfTestHistoryEntry,
  SelfTestStatus,
  SelfTestType,
  SmartAttributes,
  SmartCapabilitiesInfo,
  SmartClient,
  SmartHealth,
  SmartRawAttribute,
  SmartSpinState,
} from './types.js';

const execFileAsync = promisify(execFile);

/**
 * NmdDisk.device (from nmdctl status) is a bare name like "sda1" — every other caller in this
 * codebase that needs a real path prepends /dev/ itself (see realClient.ts's own `add` command
 * construction). This one didn't, so smartctl got literally "sda1" and failed outright
 * ("Smartctl open device: sda1 failed: No such device") — confirmed live, every array disk's
 * temperature/health/attributes silently came back null everywhere (live UI and history both).
 * The boot disk's own identity (SystemStatsService) already resolves a full /dev/-prefixed path,
 * so this has to be idempotent rather than a blind prepend, to stay correct for both callers.
 */
function devicePath(device: string): string {
  return device.startsWith('/dev/') ? device : `/dev/${device}`;
}

interface SmartctlAtaAttributeFlags {
  value?: number;
  prefailure?: boolean;
  updated_online?: boolean;
}

interface SmartctlAtaAttribute {
  id?: number;
  name?: string;
  value?: number;
  worst?: number;
  thresh?: number;
  when_failed?: string;
  flags?: SmartctlAtaAttributeFlags;
  raw?: { value?: number; string?: string };
}

interface SmartctlSelfTestLogEntry {
  type?: { string?: string };
  status?: { string?: string; passed?: boolean };
  lifetime_hours?: number;
}

interface SmartctlWwn {
  naa?: number;
  oui?: number;
  id?: number;
}

interface SmartctlJson {
  model_name?: string;
  serial_number?: string;
  wwn?: SmartctlWwn;
  rotation_rate?: number;
  user_capacity?: { bytes?: number };
  temperature?: { current?: number };
  nvme_smart_health_information_log?: { temperature?: number; power_on_hours?: number; power_cycles?: number };
  power_on_time?: { hours?: number };
  power_cycle_count?: number;
  ata_smart_attributes?: { table?: SmartctlAtaAttribute[] };
  ata_smart_data?: {
    offline_data_collection?: { status?: { string?: string }; completion_seconds?: number };
    capabilities?: {
      exec_offline_immediate_supported?: boolean;
      offline_surface_scan_supported?: boolean;
      self_tests_supported?: boolean;
      conveyance_self_test_supported?: boolean;
      selective_self_test_supported?: boolean;
      attribute_autosave_enabled?: boolean;
      error_logging_supported?: boolean;
      gp_logging_supported?: boolean;
    };
    self_test?: {
      status?: { passed?: boolean; string?: string };
      polling_minutes?: { short?: number; extended?: number };
    };
  };
  ata_sct_capabilities?: { value?: number };
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
 * Field names verified against real `smartctl --json -a` output from a PNY
 * SATA SSD (smartmontools 7.5) — see the Disks tab handoff for how this was
 * originally written speculatively, then confirmed. NVMe/other-vendor shapes
 * are still unverified, so every field falls back to null/unknown rather than
 * throwing — an unexpected shape degrades to "—" in the UI instead of breaking it.
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

function extractRawAttributes(data: SmartctlJson): SmartRawAttribute[] {
  const table = data.ata_smart_attributes?.table;
  if (!table) return [];
  return table.map((a) => ({
    id: a.id ?? 0,
    name: a.name ?? 'Unknown_Attribute',
    flagHex: typeof a.flags?.value === 'number' ? `0x${a.flags.value.toString(16).padStart(4, '0')}` : null,
    value: typeof a.value === 'number' ? a.value : null,
    worst: typeof a.worst === 'number' ? a.worst : null,
    threshold: typeof a.thresh === 'number' ? a.thresh : null,
    type: typeof a.flags?.prefailure === 'boolean' ? (a.flags.prefailure ? 'Pre-fail' : 'Old age') : null,
    updated: typeof a.flags?.updated_online === 'boolean' ? (a.flags.updated_online ? 'Always' : 'Offline') : null,
    whenFailed: a.when_failed && a.when_failed.length > 0 ? a.when_failed : 'Never',
    rawValue: typeof a.raw?.value === 'number' ? a.raw.value : null,
    rawString: a.raw?.string ?? null,
  }));
}

/** SCT "Status supported" is bit 0 of the capabilities word — the named sub-flags cover other SCT features. */
function extractCapabilitiesInfo(data: SmartctlJson): SmartCapabilitiesInfo {
  const caps = data.ata_smart_data?.capabilities;
  const offline = data.ata_smart_data?.offline_data_collection;
  const selfTest = data.ata_smart_data?.self_test;
  const sct = data.ata_sct_capabilities;
  return {
    offlineDataCollectionStatus: offline?.status?.string ?? null,
    offlineDataCollectionSeconds: typeof offline?.completion_seconds === 'number' ? offline.completion_seconds : null,
    selfTestExecutionStatus: selfTest?.status?.string ?? null,
    shortSelfTestPollingMinutes: typeof selfTest?.polling_minutes?.short === 'number' ? selfTest.polling_minutes.short : null,
    extendedSelfTestPollingMinutes: typeof selfTest?.polling_minutes?.extended === 'number' ? selfTest.polling_minutes.extended : null,
    execOfflineImmediateSupported: caps?.exec_offline_immediate_supported ?? null,
    offlineSurfaceScanSupported: caps?.offline_surface_scan_supported ?? null,
    selfTestSupported: caps?.self_tests_supported ?? null,
    conveyanceSelfTestSupported: caps?.conveyance_self_test_supported ?? null,
    selectiveSelfTestSupported: caps?.selective_self_test_supported ?? null,
    attributeAutosaveEnabled: caps?.attribute_autosave_enabled ?? null,
    errorLoggingSupported: caps?.error_logging_supported ?? null,
    generalPurposeLoggingSupported: caps?.gp_logging_supported ?? null,
    sctStatusSupported: typeof sct?.value === 'number' ? (sct.value & 1) === 1 : null,
  };
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

/** Concatenates naa+oui+id into the same hex string smartctl's own classic "LU WWN Device Id"
 *  output shows (e.g. "5 0014ee 0038f42c5" without the spaces) — verified live against a real
 *  drive's `smartctl -i` output this session. */
function formatWwn(wwn: SmartctlWwn | undefined): string | null {
  if (typeof wwn?.naa !== 'number' || typeof wwn?.oui !== 'number' || typeof wwn?.id !== 'number') return null;
  return wwn.naa.toString(16) + wwn.oui.toString(16).padStart(6, '0') + wwn.id.toString(16).padStart(9, '0');
}

/** rotation_rate of 0 means SSD (not a meaningful RPM value) — null here for both that case and
 *  drives that just don't report the field at all (confirmed live: some HDDs genuinely omit it). */
function extractRotationRpm(data: SmartctlJson): number | null {
  return typeof data.rotation_rate === 'number' && data.rotation_rate > 0 ? data.rotation_rate : null;
}

export class RealSmartClient implements SmartClient {

  private async run(device: string): Promise<{ data: SmartctlJson; spinState: SmartSpinState }> {
    // -n standby: don't spin up a sleeping disk just to check its temperature.
    const args = ['-n', 'standby', '--json', '-a', devicePath(device)];
    const bin = config.smartUseSudo ? 'sudo' : config.smartctlBin;
    const fullArgs = config.smartUseSudo ? [config.smartctlBin, ...args] : args;

    try {
      const { stdout } = await execFileAsync(bin, fullArgs, { timeout: config.smartTimeoutMs, maxBuffer: 4 * 1024 * 1024 });
      return { data: JSON.parse(stdout) as SmartctlJson, spinState: 'active' };
    } catch (err) {
      // smartctl's exit code is a bitmask of conditions (device asleep, SMART
      // check failed, etc) — nonzero doesn't mean the JSON on stdout is bad.
      // Bit 1 (value 2) specifically means the device didn't return an IDENTIFY
      // structure because -n standby made it skip rather than spin up — smartctl's
      // own documented exit-status bitmask, not stated anywhere in the JSON itself.
      const stdout = (err as { stdout?: string }).stdout;
      const exitCode = (err as { code?: number | string }).code;
      const isStandbySkip = typeof exitCode === 'number' && (exitCode & 2) !== 0;
      if (stdout) {
        try {
          return { data: JSON.parse(stdout) as SmartctlJson, spinState: isStandbySkip ? 'standby' : 'active' };
        } catch {
          // fall through below
        }
      }
      if (isStandbySkip) return { data: {}, spinState: 'standby' };
      throw err;
    }
  }

  async getTemperature(device: string): Promise<number | null> {
    try {
      const { data } = await this.run(device);
      return extractTemperatureC(data);
    } catch {
      return null;
    }
  }

  async getHealth(device: string): Promise<SmartHealth | null> {
    try {
      const { data } = await this.run(device);
      if (typeof data.smart_status?.passed !== 'boolean') return null;
      return data.smart_status.passed ? 'passed' : 'failed';
    } catch {
      return null;
    }
  }

  async getAttributes(device: string): Promise<SmartAttributes | null> {
    let data: SmartctlJson;
    let spinState: SmartSpinState;
    try {
      ({ data, spinState } = await this.run(device));
    } catch {
      return null;
    }
    // A standby skip means "asleep", not "error" — worth reporting (mostly-null attributes plus
    // the real spin state) rather than collapsing to null like a genuine read failure would.
    if (
      spinState !== 'standby' &&
      typeof data.smart_status?.passed !== 'boolean' &&
      !data.ata_smart_attributes &&
      !data.nvme_smart_health_information_log
    ) {
      return null; // no SMART data at all — e.g. a virtio-blk device with no pass-through
    }

    const caps = data.ata_smart_data?.capabilities;
    return {
      device,
      model: data.model_name ?? null,
      serial: data.serial_number ?? null,
      wwn: formatWwn(data.wwn),
      capacityBytes: data.user_capacity?.bytes ?? null,
      health: typeof data.smart_status?.passed === 'boolean' ? (data.smart_status.passed ? 'passed' : 'failed') : null,
      temperature: extractTemperatureC(data),
      rotationRpm: extractRotationRpm(data),
      spinState,
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
      rawAttributes: extractRawAttributes(data),
      capabilitiesInfo: extractCapabilitiesInfo(data),
    };
  }

  async startSelfTest(device: string, type: SelfTestType): Promise<void> {
    const args = ['-t', type, devicePath(device)];
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
