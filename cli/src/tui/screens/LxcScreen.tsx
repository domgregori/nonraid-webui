import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ApiClient } from '../../api/client.js';
import type { CommandResult, LxcContainerSummary } from '../../api/types.js';
import { StatusLine } from '../StatusLine.js';
import { useListNav } from '../useListNav.js';
import { usePolling } from '../usePolling.js';

interface Props {
  client: ApiClient;
}

export function LxcScreen({ client }: Props) {
  const { data: containers, error, refresh } = usePolling(() => client.get<LxcContainerSummary[]>('/lxc/containers'));
  const [selected] = useListNav(containers?.length ?? 0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const toggle = async (c: LxcContainerSummary) => {
    setBusy(true);
    setMessage(null);
    const running = c.state === 'running';
    try {
      const result = running
        ? await client.post<CommandResult>(`/lxc/containers/${encodeURIComponent(c.name)}/stop`, { force: false })
        : await client.post<CommandResult>(`/lxc/containers/${encodeURIComponent(c.name)}/start`);
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
      <Text underline>LXC ({containers?.length ?? 0}) — ↑/↓ select, s start/stop, r refresh</Text>
      {containers?.length === 0 && <Text dimColor>none</Text>}
      {containers?.map((c, i) => (
        <Text key={c.name} color={i === selected ? 'cyan' : undefined}>
          {i === selected ? '▶ ' : '  '}
          {c.name.padEnd(24)} {c.state.padEnd(10)} {c.autostart ? 'autostart' : '         '} {c.ips.join(', ')}
          {c.cpuPercent !== null ? ` — ${c.cpuPercent.toFixed(0)}% cpu` : ''}
        </Text>
      ))}
      <Box marginTop={1}>
        <StatusLine error={error} message={message} busy={busy} />
      </Box>
    </Box>
  );
}
