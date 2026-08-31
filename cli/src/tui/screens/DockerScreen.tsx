import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ApiClient } from '../../api/client.js';
import type { CommandResult, DockerContainerSummary } from '../../api/types.js';
import { StatusLine } from '../StatusLine.js';
import { useListNav } from '../useListNav.js';
import { usePolling } from '../usePolling.js';

interface Props {
  client: ApiClient;
}

export function DockerScreen({ client }: Props) {
  const { data: containers, error, refresh } = usePolling(() => client.get<DockerContainerSummary[]>('/docker/containers'));
  const [selected] = useListNav(containers?.length ?? 0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const toggle = async (c: DockerContainerSummary) => {
    setBusy(true);
    setMessage(null);
    const action = c.state === 'running' ? 'stop' : 'start';
    try {
      const result = await client.post<CommandResult>(`/docker/containers/${encodeURIComponent(c.name)}/${action}`);
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
    if (input === 's' && !busy && containers?.[selected]) void toggle(containers[selected]);
  });

  return (
    <Box flexDirection="column">
      <Text underline>Docker ({containers?.length ?? 0}) — ↑/↓ select, s start/stop, r refresh</Text>
      {containers?.length === 0 && <Text dimColor>none</Text>}
      {containers?.map((c, i) => (
        <Text key={c.id} color={i === selected ? 'cyan' : undefined}>
          {i === selected ? '▶ ' : '  '}
          {c.name.padEnd(24)} {c.state.padEnd(10)} {c.status.padEnd(20)} {c.image}
          {c.cpuPercent !== null ? ` — ${c.cpuPercent.toFixed(0)}% cpu` : ''}
        </Text>
      ))}
      <Box marginTop={1}>
        <StatusLine error={error} message={message} busy={busy} />
      </Box>
    </Box>
  );
}
