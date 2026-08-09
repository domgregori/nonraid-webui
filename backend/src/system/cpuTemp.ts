import fs from 'node:fs';

const CPU_HWMON_DRIVERS = ['coretemp', 'k10temp', 'zenpower', 'cpu_thermal'];
const PREFERRED_LABELS = ['package id 0', 'tdie', 'tctl'];

function readFileTrim(path: string): string | null {
  try {
    return fs.readFileSync(path, 'utf8').trim();
  } catch {
    return null;
  }
}

/**
 * Best-effort CPU package temperature via the kernel's own hwmon sysfs
 * interface (/sys/class/hwmon) — no lm-sensors dependency, just file reads.
 * Returns null on any environment without a recognized CPU temp driver
 * (containers, VMs, unusual hardware) rather than guessing.
 */
export function readCpuTempCelsius(): number | null {
  let hwmonDirs: string[];
  try {
    hwmonDirs = fs.readdirSync('/sys/class/hwmon');
  } catch {
    return null;
  }

  for (const dir of hwmonDirs) {
    const base = `/sys/class/hwmon/${dir}`;
    const name = readFileTrim(`${base}/name`);
    if (!name || !CPU_HWMON_DRIVERS.includes(name)) continue;

    let entries: string[];
    try {
      entries = fs.readdirSync(base);
    } catch {
      continue;
    }
    const inputs = entries.filter((f) => /^temp\d+_input$/.test(f)).sort();
    if (inputs.length === 0) continue;

    let chosen = inputs[0];
    for (const input of inputs) {
      const label = readFileTrim(`${base}/${input.replace('_input', '_label')}`)?.toLowerCase();
      if (label && PREFERRED_LABELS.some((p) => label.includes(p))) {
        chosen = input;
        break;
      }
    }

    const milliCelsius = Number(readFileTrim(`${base}/${chosen}`));
    if (!Number.isFinite(milliCelsius)) continue;
    return Math.round(milliCelsius) / 1000;
  }

  return null;
}
