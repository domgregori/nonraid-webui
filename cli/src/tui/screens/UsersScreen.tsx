import { Box, Text, useInput } from 'ink';
import type { ApiClient } from '../../api/client.js';
import type { NrGroup, NrUser } from '../../api/types.js';
import { StatusLine } from '../StatusLine.js';
import { usePolling } from '../usePolling.js';

interface Props {
  client: ApiClient;
}

async function load(client: ApiClient): Promise<{ users: NrUser[]; groups: NrGroup[] }> {
  const [users, groups] = await Promise.all([client.get<NrUser[]>('/users'), client.get<NrGroup[]>('/groups')]);
  return { users, groups };
}

// View-only - see SharesScreen's comment on why creation stays a CLI-flag operation, not a TUI
// form. Users and groups share a screen since both are small, simple lists most naturally read
// together (a group's own row doesn't say who's in it - cross-reference against the users list
// above it, same as scanning `nonraid-tool user ls` next to `nonraid-tool group ls` would).
export function UsersScreen({ client }: Props) {
  const { data, error, refresh } = usePolling(() => load(client));

  useInput((input) => {
    if (input === 'r') void refresh();
  });

  return (
    <Box flexDirection="column">
      <Text underline>Users & Groups — r refresh (view-only; use `nonraid-tool user`/`group` to change)</Text>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Users ({data?.users.length ?? 0})</Text>
        {data?.users.length === 0 && <Text dimColor>none</Text>}
        {data?.users.map((u) => (
          <Text key={u.username}>
            {u.username.padEnd(20)} uid {String(u.uid).padEnd(8)} {u.groups.join(', ')}
          </Text>
        ))}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Groups ({data?.groups.length ?? 0})</Text>
        {data?.groups.length === 0 && <Text dimColor>none</Text>}
        {data?.groups.map((g) => (
          <Text key={g.name}>
            {g.name.padEnd(20)} gid {g.gid}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <StatusLine error={error} />
      </Box>
    </Box>
  );
}
