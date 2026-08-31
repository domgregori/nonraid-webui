import { Box, Text, useInput } from 'ink';
import type { ApiClient } from '../../api/client.js';
import type { ShareWithStats } from '../../api/types.js';
import { formatBytes } from '../format.js';
import { StatusLine } from '../StatusLine.js';
import { usePolling } from '../usePolling.js';

interface Props {
  client: ApiClient;
}

// View-only, deliberately - creating/editing a share is several fields (disks, allocation,
// protocols, ...) that fit `nonraid-tool share create`'s flags much better than a TUI form. See
// this file's sibling screens for the same call on Users/Groups/Rclone remotes.
export function SharesScreen({ client }: Props) {
  const { data: shares, error, refresh } = usePolling(() => client.get<ShareWithStats[]>('/shares'));

  useInput((input) => {
    if (input === 'r') void refresh();
  });

  return (
    <Box flexDirection="column">
      <Text underline>Shares ({shares?.length ?? 0}) — r refresh (view-only; use `nonraid-tool share` to change)</Text>
      {shares?.length === 0 && <Text dimColor>none</Text>}
      {shares?.map((s) => (
        <Text key={s.name}>
          {s.name.padEnd(20)} {s.protocols.join('+').padEnd(8)} {s.allocationMethod.padEnd(12)}{' '}
          {formatBytes(s.stats.usedBytes)}/{formatBytes(s.stats.totalBytes)} · {s.activeConnections} connections
        </Text>
      ))}
      <Box marginTop={1}>
        <StatusLine error={error} />
      </Box>
    </Box>
  );
}
