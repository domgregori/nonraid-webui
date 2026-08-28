import { Command } from 'commander';
import { resolveClient } from '../context.js';
import { printTable, runAction } from '../output.js';
import type { BootSnapshotsResponse, CommandResult, RestartServicesResult, SystemStats } from '../api/types.js';

function fmtBytes(n: number | null): string {
  return n === null ? '-' : `${(n / 1e9).toFixed(1)} GB`;
}

function fmtUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

export function registerSystemCommand(program: Command): void {
  const system = program.command('system').description('host system info and controls');

  system
    .command('info')
    .description('show hostname, uptime, CPU/memory, version, boot disk')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const s = await client.get<SystemStats>('/system');
        console.log(`Hostname: ${s.hostname}  Timezone: ${s.timezone}  Version: ${s.version}${s.buildVersion ? ` (${s.buildVersion})` : ''}`);
        console.log(`Uptime: ${fmtUptime(s.uptimeSeconds)}`);
        console.log(`CPU: ${s.cpuPercent.toFixed(1)}%${s.cpuTempCelsius !== null ? ` @ ${s.cpuTempCelsius}°C` : ''}  Mem: ${fmtBytes(s.memUsedBytes)} / ${fmtBytes(s.memTotalBytes)}`);
        if (s.bootDisk) {
          console.log(`Boot disk: ${s.bootDisk.device} (${s.bootDisk.model ?? 'unknown model'}) ${fmtBytes(s.bootDisk.usedBytes)} / ${fmtBytes(s.bootDisk.totalBytes)}`);
        }
        for (const iface of s.networkInterfaces) {
          console.log(`  ${iface.name}: ${[...iface.ipv4, ...iface.ipv6].join(', ') || '(no address)'}`);
        }
      }),
    );

  system
    .command('set-hostname <hostname>')
    .description('set the host name')
    .action(
      runAction(async (hostname: string) => {
        const client = await resolveClient();
        const result = await client.put<CommandResult>('/system/hostname', { hostname });
        console.log(result.message);
      }),
    );

  system
    .command('timezones')
    .description('list valid IANA timezone names')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const zones = await client.get<string[]>('/system/timezones');
        for (const z of zones) console.log(z);
      }),
    );

  system
    .command('set-timezone <timezone>')
    .description('set the host timezone (IANA name) - restarts nonraid-webui to pick it up')
    .action(
      runAction(async (timezone: string) => {
        const client = await resolveClient();
        const result = await client.put<CommandResult>('/system/timezone', { timezone });
        console.log(result.message);
      }),
    );

  system
    .command('reboot')
    .description('reboot the host')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const result = await client.post<CommandResult>('/system/reboot');
        console.log(result.message);
      }),
    );

  system
    .command('reload-driver')
    .description('manually retry an nmdctl driver reload / superblock re-import')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const result = await client.post<{ result: { importedCount: number } }>('/system/reload-driver');
        console.log(`Driver reloaded, ${result.result.importedCount} disk(s) re-imported.`);
      }),
    );

  system
    .command('restart-services')
    .description('restart SMB/NFS, reload the driver, then self-restart nonraid-webui')
    .option('--restart-docker', 'also restart Docker')
    .action(
      runAction(async (opts: { restartDocker?: boolean }) => {
        const client = await resolveClient();
        const result = await client.post<RestartServicesResult>('/system/restart-services', { restartDocker: !!opts.restartDocker });
        console.log(`SMB: ${result.smb.ok ? 'ok' : 'FAILED'} - ${result.smb.message}`);
        console.log(`NFS: ${result.nfs.ok ? 'ok' : 'FAILED'} - ${result.nfs.message}`);
        console.log(`Driver reload: ${result.driverReload.ok ? 'ok' : 'FAILED'} - ${result.driverReload.message}`);
        console.log(`rclone-rcd: ${result.rcloneRcd.ok ? 'ok' : 'FAILED'} - ${result.rcloneRcd.message}`);
        if (result.docker) console.log(`Docker: ${result.docker.ok ? 'ok' : 'FAILED'} - ${result.docker.message}`);
        console.log(result.message);
      }),
    );

  const backup = system.command('backup').description('boot-disk / config backup controls');
  backup
    .command('run-now')
    .description('run the configured scheduled backup on demand')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const result = await client.post('/system/backup/run-now');
        console.log(JSON.stringify(result, null, 2));
      }),
    );

  const snapshot = system.command('snapshot').description('read-only btrfs boot-disk snapshots');
  snapshot
    .command('ls')
    .description('list boot-disk snapshots')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const { btrfsRoot, snapshots } = await client.get<BootSnapshotsResponse>('/system/boot-snapshots');
        if (!btrfsRoot) {
          console.log('Root filesystem is not btrfs - snapshots are unavailable.');
          return;
        }
        printTable(
          ['NAME', 'KIND', 'LABEL', 'CREATED', 'GRUB', 'SIZE(GB)'],
          snapshots.map((s) => [s.name, s.kind, s.label ?? '-', s.createdAtLocal, s.inGrubMenu ? 'yes' : 'no', s.size ? (s.size.exclusiveBytes / 1e9).toFixed(2) : '-']),
        );
      }),
    );

  snapshot
    .command('create')
    .description('create a manual boot-disk snapshot')
    .option('--label <label>', 'optional label suffix')
    .action(
      runAction(async (opts: { label?: string }) => {
        const client = await resolveClient();
        const s = await client.post<{ name: string }>('/system/boot-snapshots', opts.label ? { label: opts.label } : {});
        console.log(`Snapshot "${s.name}" created.`);
      }),
    );

  snapshot
    .command('rm <name>')
    .description('delete a boot-disk snapshot')
    .action(
      runAction(async (name: string) => {
        const client = await resolveClient();
        const result = await client.delete<CommandResult>(`/system/boot-snapshots/${encodeURIComponent(name)}`);
        console.log(result.message);
      }),
    );
}
