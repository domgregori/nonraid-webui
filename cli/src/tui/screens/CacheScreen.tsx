import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ApiClient } from '../../api/client.js';
import type { CacheMoverStatus, CacheStatus, CommandResult } from '../../api/types.js';
import { formatBytes } from '../format.js';
import { StatusLine } from '../StatusLine.js';
import { usePolling } from '../usePolling.js';

interface Props {
  client: ApiClient;
}

async function load(client: ApiClient): Promise<{ cache: CacheStatus; mover: CacheMoverStatus }> {
  const [cache, mover] = await Promise.all([client.get<CacheStatus>('/cache/status'), client.get<CacheMoverStatus>('/cache/mover/status')]);
  return { cache, mover };
}

// Setup/replace (reassigning real disks to the cache pool) stay CLI-only - `nonraid-tool cache
// setup/replace` - too consequential and multi-field for a single keypress. The mover is a safe
// single toggle action: run it if idle, cancel if it's already running.
export function CacheScreen({ client }: Props) {
  const { data, error, refresh } = usePolling(() => load(client));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const toggleMover = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = data?.mover.running ? await client.post<CommandResult>('/cache/mover/cancel') : await client.post<CommandResult>('/cache/mover/run');
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
    if (input === 's' && !busy && data) void toggleMover();
  });

  const cache = data?.cache;

  return (
    <Box flexDirection="column">
      <Text underline>Cache — s {data?.mover.running ? 'cancel mover' : 'run mover'}, r refresh</Text>
      {cache && (
        <Box marginTop={1} flexDirection="column">
          <Text>
            Health: <Text bold>{cache.health}</Text> · {cache.enabled ? 'enabled' : 'disabled'} for pools
          </Text>
          <Text dimColor>
            {formatBytes(cache.usedBytes)}/{formatBytes(cache.totalBytes)} used
          </Text>
          {cache.devices.map((d) => (
            <Text key={d.devid} dimColor>
              devid {d.devid} {d.path ?? '(missing)'} {d.model ?? ''} — {d.smartHealth ?? 'unknown'}
            </Text>
          ))}
        </Box>
      )}
      <Box marginTop={1}>
        <Text>Mover: {data?.mover.running ? <Text color="cyan">running</Text> : <Text dimColor>idle</Text>}</Text>
      </Box>
      <Box marginTop={1}>
        <StatusLine error={error} message={message} busy={busy} />
      </Box>
    </Box>
  );
}
