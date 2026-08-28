import { Command } from 'commander';
import { resolveClient } from '../context.js';
import { printTable, runAction } from '../output.js';
import type { SmartAttributes, SmartHealth, SmartSpinState } from '../api/types.js';

export function registerSmartCommand(program: Command): void {
  const smart = program.command('smart').description('SMART - temperatures/health/attributes across all array disks');

  smart
    .command('temps')
    .description('temperature (°C) of every disk currently in the array')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const temps = await client.get<Record<string, number | null>>('/smart/temperatures');
        printTable(
          ['DEVICE', 'TEMP(C)'],
          Object.entries(temps).map(([device, t]) => [device, t === null ? '-' : String(t)]),
        );
      }),
    );

  smart
    .command('spin-states')
    .description('active/standby power state of every disk currently in the array')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const states = await client.get<Record<string, SmartSpinState>>('/smart/spin-states');
        printTable(
          ['DEVICE', 'STATE'],
          Object.entries(states).map(([device, s]) => [device, s]),
        );
      }),
    );

  smart
    .command('health')
    .description('pass/fail SMART health status per array disk')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const health = await client.get<Record<string, SmartHealth | null>>('/smart/health');
        printTable(
          ['DEVICE', 'HEALTH'],
          Object.entries(health).map(([device, h]) => [device, h ?? 'unknown']),
        );
      }),
    );

  smart
    .command('disk-types')
    .description('ssd/hdd type per array disk')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        // Despite API.md's documented `'ssd' | 'hdd'` shape, the live route (getDiskType(), from
        // lsblk's ROTA flag) actually returns boolean | null (true = SSD) - matched against the
        // real rig, not the doc.
        const types = await client.get<Record<string, boolean | null>>('/smart/disk-types');
        printTable(
          ['DEVICE', 'TYPE'],
          Object.entries(types).map(([device, isSsd]) => [device, isSsd === null ? 'unknown' : isSsd ? 'ssd' : 'hdd']),
        );
      }),
    );

  smart
    .command('device <device>')
    .description('full SMART attributes for a device with no array slot (unassigned or boot disk)')
    .action(
      runAction(async (device: string) => {
        const client = await resolveClient();
        const a = await client.get<SmartAttributes | null>(`/smart/by-device?device=${encodeURIComponent(device)}`);
        if (!a) {
          console.log(`No SMART data available for ${device}.`);
          return;
        }
        printAttributes(a);
      }),
    );
}

function printAttributes(a: SmartAttributes): void {
  console.log(`Device: ${a.device}  Model: ${a.model ?? '-'}  Serial: ${a.serial ?? '-'}`);
  console.log(`Health: ${a.health ?? 'unknown'}  Spin: ${a.spinState}  Temp: ${a.temperature ?? '-'}°C  Capacity: ${a.capacityBytes ? (a.capacityBytes / 1e9).toFixed(1) + ' GB' : '-'}`);
  console.log(`Power-on hours: ${a.powerOnHours ?? '-'}  Power cycles: ${a.powerCycleCount ?? '-'}`);
  console.log(`Reallocated: ${a.reallocatedSectors ?? '-'}  Pending: ${a.pendingSectors ?? '-'}  Uncorrectable: ${a.uncorrectableSectors ?? '-'}`);
  console.log(`Self-test: ${a.selfTest.state}${a.selfTest.progressPct !== null ? ` (${a.selfTest.progressPct}%)` : ''}${a.selfTest.statusText ? ` - ${a.selfTest.statusText}` : ''}`);
}

export { printAttributes as printSmartAttributes };
