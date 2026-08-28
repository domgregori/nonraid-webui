import { Command } from 'commander';
import { resolveClient } from '../context.js';
import { printTable, runAction } from '../output.js';
import type { CommandResult, NmdStatusResponse } from '../api/types.js';

export function registerArrayCommand(program: Command): void {
  const array = program.command('array').description('array status and lifecycle');

  array
    .command('status')
    .description('show array state, health, and per-disk summary')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const { array: a, resync } = await client.get<NmdStatusResponse>('/status');
        console.log(`State: ${a.state}  Label: ${a.label || '(none)'}`);
        console.log(`Disks: ${a.disks_imported}/${a.total_slots} imported, ${a.disks_present} present, ${a.disks_unassigned} unassigned`);
        if (a.health.missing || a.health.disabled || a.health.disk_errors || a.health.sync_errors) {
          console.log(`Health: missing=${a.health.missing} disabled=${a.health.disabled} disk_errors=${a.health.disk_errors} sync_errors=${a.health.sync_errors}`);
        }
        if (resync.active || resync.pending) {
          console.log(`Parity ${resync.action}: ${resync.progress_percent}% @ ${resync.rate_mb_s} MB/s, ETA ${resync.eta_seconds}s${resync.paused ? ' (paused)' : ''}`);
        }
      }),
    );

  array
    .command('start')
    .description('start the array')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const result = await client.post<CommandResult>('/array/start');
        console.log(result.message);
      }),
    );

  array
    .command('stop')
    .description('stop the array')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const result = await client.post<CommandResult>('/array/stop');
        console.log(result.message);
      }),
    );
}

export function registerDiskCommand(program: Command): void {
  const disk = program.command('disk').description('per-disk operations');

  disk
    .command('ls')
    .description('list array disks')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const { disks } = await client.get<NmdStatusResponse>('/status');
        printTable(
          ['SLOT', 'TYPE', 'DEVICE', 'NAME', 'SIZE(GB)', 'STATUS'],
          disks.map((d) => [String(d.slot), d.type, d.device || '-', d.disk_name || '-', String(d.size_gb), d.status]),
        );
      }),
    );

  disk
    .command('spin-down <slot>')
    .description('spin down the disk in the given slot')
    .action(
      runAction(async (slot: string) => {
        const client = await resolveClient();
        const result = await client.post<CommandResult>(`/disks/${slot}/spin-down`);
        console.log(result.message);
      }),
    );

  disk
    .command('spin-up <slot>')
    .description('spin up the disk in the given slot')
    .action(
      runAction(async (slot: string) => {
        const client = await resolveClient();
        const result = await client.post<CommandResult>(`/disks/${slot}/spin-up`);
        console.log(result.message);
      }),
    );
}

export function registerParityCommand(program: Command): void {
  const parity = program.command('parity').description('parity check status/control');

  parity
    .command('status')
    .description('show current parity check progress')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const { resync } = await client.get<NmdStatusResponse>('/status');
        if (!resync.active && !resync.pending) {
          console.log('No parity check in progress.');
          return;
        }
        console.log(`${resync.action}: ${resync.progress_percent}% @ ${resync.rate_mb_s} MB/s, ETA ${resync.eta_seconds}s${resync.paused ? ' (paused)' : ''}`);
      }),
    );

  parity
    .command('start')
    .description('start a correcting parity check')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const result = await client.post<CommandResult>('/parity/CORRECT');
        console.log(result.message);
      }),
    );
}
