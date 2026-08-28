import { Command } from 'commander';
import { resolveClient } from '../context.js';
import { printTable, runAction } from '../output.js';
import type { ShareInput, ShareWithStats } from '../api/types.js';

interface ShareOpts {
  allocation: string;
  disks?: string;
  allDisks?: boolean;
  protocols: string;
  description?: string;
  smbPublic?: boolean;
  nfsHosts?: string;
  nfsReadOnly?: boolean;
}

function buildBody(name: string, opts: ShareOpts): ShareInput {
  const protocols = opts.protocols
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean) as ShareInput['protocols'];
  const disks = (opts.disks ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);

  const body: ShareInput = {
    name,
    disks,
    allocationMethod: opts.allocation as ShareInput['allocationMethod'],
    protocols,
  };
  if (opts.allDisks) body.allDisks = true;
  if (opts.description) body.description = opts.description;
  if (protocols.includes('smb')) body.smb = { public: !!opts.smbPublic };
  if (protocols.includes('nfs')) {
    body.nfs = {
      allowedHosts: (opts.nfsHosts ?? '')
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean),
      readOnly: !!opts.nfsReadOnly,
    };
  }
  return body;
}

function addShareOptions<T extends Command>(cmd: T): T {
  return cmd
    .requiredOption('--allocation <method>', 'most-free | fill-up | high-water | single-disk | cache-only')
    .option('--disks <slots>', 'comma-separated data disk slots, e.g. 1,2,3', '')
    .option('--all-disks', 'grow to cover any new data disk automatically')
    .option('--protocols <protocols>', 'comma-separated: smb,nfs', 'smb')
    .option('--description <text>', 'free-text description (also shown in smb.conf)')
    .option('--smb-public', 'allow public (guest) SMB access')
    .option('--nfs-hosts <hosts>', 'comma-separated NFS-allowed hosts/subnets', '')
    .option('--nfs-read-only', 'export over NFS read-only');
}

export function registerShareCommand(program: Command): void {
  const share = program.command('share').description('shares (pools) - create, list, and manage');

  share
    .command('ls')
    .description('list shares with live usage stats')
    .action(
      runAction(async () => {
        const client = await resolveClient();
        const shares = await client.get<ShareWithStats[]>('/shares');
        printTable(
          ['NAME', 'ALLOCATION', 'PROTOCOLS', 'DISKS', 'USED/TOTAL(GB)', 'CONNS'],
          shares.map((s) => {
            const used = s.stats.usedBytes !== null ? (s.stats.usedBytes / 1e9).toFixed(1) : '-';
            const total = s.stats.totalBytes !== null ? (s.stats.totalBytes / 1e9).toFixed(1) : '-';
            return [s.name, s.allocationMethod, s.protocols.join(','), s.allDisks ? 'all' : s.disks.join(','), `${used}/${total}`, String(s.activeConnections)];
          }),
        );
      }),
    );

  addShareOptions(share.command('create <name>'))
    .description('create a share (pool)')
    .action(
      runAction(async (name: string, opts: ShareOpts) => {
        const client = await resolveClient();
        await client.post<ShareWithStats>('/shares', buildBody(name, opts));
        console.log(`Share "${name}" created.`);
      }),
    );

  addShareOptions(share.command('update <name>'))
    .option('--rename <newName>', 'rename the share')
    .description('update a share (pool) - same flags as create')
    .action(
      runAction(async (name: string, opts: ShareOpts & { rename?: string }) => {
        const client = await resolveClient();
        const body = buildBody(opts.rename ?? name, opts);
        await client.put<ShareWithStats>(`/shares/${encodeURIComponent(name)}`, body);
        console.log(`Share "${name}" updated${opts.rename ? ` (renamed to "${opts.rename}")` : ''}.`);
      }),
    );

  share
    .command('rm <name>')
    .description('delete a share (unmounts/un-exports only - never deletes files)')
    .action(
      runAction(async (name: string) => {
        const client = await resolveClient();
        await client.delete(`/shares/${encodeURIComponent(name)}`);
        console.log(`Share "${name}" deleted.`);
      }),
    );
}
