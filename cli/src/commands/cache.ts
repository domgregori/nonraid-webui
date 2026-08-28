import { Command } from 'commander';
import { resolveClient } from '../context.js';
import { runAction } from '../output.js';
import type { CacheMoverStatus, CacheReplaceStatus, CacheStatus, CommandResult } from '../api/types.js';

export function registerCacheCommand(program: Command): void {
  const cache = program.command('cache').description('mirrored cache pool and cache mover');

  cache
    .command('status')
    .description('show cache pool health/devices/usage')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const s = await client.get<CacheStatus>('/cache/status');
        console.log(`Health: ${s.health}  Enabled: ${s.enabled}  fsUuid: ${s.fsUuid ?? '-'}`);
        if (s.usedBytes !== null && s.totalBytes !== null) {
          console.log(`Used: ${(s.usedBytes / 1e9).toFixed(1)} GB / ${(s.totalBytes / 1e9).toFixed(1)} GB`);
        }
        for (const d of s.devices) {
          console.log(`  devid ${d.devid}: ${d.path ?? '(missing)'} ${d.model ?? ''} health=${d.smartHealth ?? 'unknown'}${d.missing ? ' MISSING' : ''}`);
        }
      }),
    );

  cache
    .command('setup')
    .description('set up the mirrored cache pool from two devices')
    .requiredOption('--device-a <device>', 'first device, e.g. /dev/sdc')
    .requiredOption('--device-b <device>', 'second device, e.g. /dev/sdd')
    .option('--force', 'overwrite an existing filesystem on either device')
    .action(
      runAction(async (opts: { deviceA: string; deviceB: string; force?: boolean }) => {
        const client = await resolveClient();
        const result = await client.post<CommandResult>('/cache/setup', { deviceA: opts.deviceA, deviceB: opts.deviceB, force: !!opts.force });
        console.log(result.message);
      }),
    );

  cache
    .command('replace')
    .description('replace one cache mirror member')
    .requiredOption('--device <device>', 'replacement device')
    .action(
      runAction(async (opts: { device: string }) => {
        const client = await resolveClient();
        const result = await client.post<CommandResult>('/cache/replace', { device: opts.device });
        console.log(result.message);
      }),
    );

  cache
    .command('replace-status')
    .description('poll progress of an in-progress cache member replacement')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const s = await client.get<CacheReplaceStatus>('/cache/replace/status');
        console.log(`Running: ${s.running}${s.progressPercent !== null ? `  ${s.progressPercent}%` : ''}${s.message ? `  ${s.message}` : ''}`);
      }),
    );

  cache
    .command('enable')
    .description('enable the cache pool for shares')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const result = await client.put<CommandResult>('/cache/enabled', { enabled: true });
        console.log(result.message);
      }),
    );

  cache
    .command('disable')
    .description('disable the cache pool for shares')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const result = await client.put<CommandResult>('/cache/enabled', { enabled: false });
        console.log(result.message);
      }),
    );

  const mover = cache.command('mover').description('cache mover (moves cached files onto the array)');
  mover
    .command('run')
    .description('start the cache mover')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const result = await client.post<CommandResult>('/cache/mover/run');
        console.log(result.message);
      }),
    );

  mover
    .command('status')
    .description('poll cache mover progress')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const s = await client.get<CacheMoverStatus>('/cache/mover/status');
        console.log(JSON.stringify(s, null, 2));
      }),
    );

  mover
    .command('cancel')
    .description('cancel the running cache mover')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const result = await client.post<CommandResult>('/cache/mover/cancel');
        console.log(result.message);
      }),
    );
}
