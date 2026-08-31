import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ApiClient } from '../../api/client.js';
import type { CommandResult, RcloneDaemonStatus, RcloneRemote, SyncJobWithRuntime } from '../../api/types.js';
import { formatPercent, formatRelativeTime } from '../format.js';
import { StatusLine } from '../StatusLine.js';
import { useListNav } from '../useListNav.js';
import { usePolling } from '../usePolling.js';

interface Props {
  client: ApiClient;
}

async function load(client: ApiClient): Promise<{ status: RcloneDaemonStatus; remotes: RcloneRemote[]; jobs: SyncJobWithRuntime[] }> {
  const [status, remotes, jobs] = await Promise.all([
    client.get<RcloneDaemonStatus>('/rclone/status'),
    client.get<RcloneRemote[]>('/rclone/remotes').catch(() => []),
    client.get<SyncJobWithRuntime[]>('/rclone/jobs').catch(() => []),
  ]);
  return { status, remotes, jobs };
}

// Remotes are view-only (adding one is several provider-specific fields - `nonraid-tool rclone
// remote add`'s flags fit that better). Jobs get one action: sync now if idle, cancel if already
// syncing - creating/editing a job's schedule/retention stays CLI-only for the same reason.
export function RcloneScreen({ client }: Props) {
  const { data, error, refresh } = usePolling(() => load(client));
  const [selected] = useListNav(data?.jobs.length ?? 0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const toggleSync = async (job: SyncJobWithRuntime) => {
    setBusy(true);
    setMessage(null);
    try {
      const result =
        job.state === 'syncing'
          ? await client.post<CommandResult>(`/rclone/jobs/${encodeURIComponent(job.id)}/cancel`)
          : await client.post<CommandResult>(`/rclone/jobs/${encodeURIComponent(job.id)}/sync`);
      setMessage(result.message);
      await refresh();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useInput((input) => {
    if (input === 'r') void refresh();
    if (input === 's' && !busy && data?.jobs[selected]) void toggleSync(data.jobs[selected]);
  });

  return (
    <Box flexDirection="column">
      <Text underline>Rclone — ↑/↓ select job, s sync now/cancel, r refresh</Text>
      {data && (
        <Text dimColor>
          Remote Backup: {data.status.featureEnabled ? 'enabled' : 'disabled'} · daemon {data.status.running ? 'running' : 'stopped'}
        </Text>
      )}
      <Box marginTop={1} flexDirection="column">
        <Text bold>Remotes ({data?.remotes.length ?? 0})</Text>
        {data?.remotes.map((r) => (
          <Text key={r.name} dimColor>
            {r.name.padEnd(20)} {r.type.padEnd(12)} {r.status}
          </Text>
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Sync jobs ({data?.jobs.length ?? 0})</Text>
        {data?.jobs.map((j, i) => (
          <Text key={j.id} color={i === selected ? 'cyan' : undefined}>
            {i === selected ? '▶ ' : '  '}
            {j.name.padEnd(20)} {j.enabled ? j.state : 'disabled'.padEnd(8)} {j.remoteName}:{j.remotePath || '/'}
            {j.state === 'syncing' && j.progress ? ` — ${formatPercent((j.progress.bytes / (j.progress.totalBytes || 1)) * 100)}` : ''}
            {j.state !== 'syncing' ? ` — last synced ${formatRelativeTime(j.lastSyncedAt)}` : ''}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <StatusLine error={error} message={message} busy={busy} />
      </Box>
    </Box>
  );
}
