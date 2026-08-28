import { useCallback, useEffect, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { ApiClient } from '../api/client.js';
import type { CommandResult, DockerContainerSummary, LxcContainerSummary, NmdStatusResponse } from '../api/types.js';

interface Props {
  client: ApiClient;
  host: string;
}

interface ContainerItem {
  kind: 'docker' | 'lxc';
  id: string; // name - both Docker's and LXC's start/stop routes accept a name, see commands/docker.ts's comment
  name: string;
  state: string;
}

const POLL_MS = 5000;

export function App({ client, host }: Props) {
  const { exit } = useApp();
  const [status, setStatus] = useState<NmdStatusResponse | null>(null);
  const [dockerContainers, setDockerContainers] = useState<DockerContainerSummary[]>([]);
  const [lxcContainers, setLxcContainers] = useState<LxcContainerSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, d, l] = await Promise.all([
        client.get<NmdStatusResponse>('/status'),
        client.get<DockerContainerSummary[]>('/docker/containers').catch(() => []),
        client.get<LxcContainerSummary[]>('/lxc/containers').catch(() => []),
      ]);
      setStatus(s);
      setDockerContainers(d);
      setLxcContainers(l);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const items: ContainerItem[] = [
    ...dockerContainers.map((c) => ({ kind: 'docker' as const, id: c.name, name: c.name, state: c.state })),
    ...lxcContainers.map((c) => ({ kind: 'lxc' as const, id: c.name, name: c.name, state: c.state })),
  ];

  const toggle = useCallback(
    async (item: ContainerItem) => {
      setBusy(true);
      setMessage(null);
      const running = item.state === 'running';
      const base = item.kind === 'docker' ? '/docker/containers' : '/lxc/containers';
      const action = running ? 'stop' : 'start';
      try {
        const result = await client.post<CommandResult>(`${base}/${encodeURIComponent(item.id)}/${action}`);
        setMessage(result.message);
        await refresh();
      } catch (err) {
        setMessage((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [client, refresh],
  );

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      exit();
      return;
    }
    if (input === 'r') {
      void refresh();
      return;
    }
    if (key.upArrow) {
      setSelected((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelected((i) => Math.min(items.length - 1, i + 1));
      return;
    }
    if (input === 's' && !busy) {
      const item = items[selected];
      if (item) void toggle(item);
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        nonraid tui — {host}
      </Text>
      {error && <Text color="red">status error: {error}</Text>}
      {status && (
        <Box marginTop={1}>
          <Text>
            Array: <Text bold>{status.array.state}</Text> ({status.array.disks_imported}/{status.array.total_slots} disks)
            {status.resync.active ? `  parity ${status.resync.action} ${status.resync.progress_percent}%` : ''}
          </Text>
        </Box>
      )}
      <Box flexDirection="column" marginTop={1}>
        <Text underline>Containers ({items.length}) — up/down select, s start/stop, r refresh, q quit</Text>
        {items.length === 0 && <Text dimColor>none</Text>}
        {items.map((item, i) => (
          <Text key={`${item.kind}-${item.id}`} color={i === selected ? 'cyan' : undefined}>
            {i === selected ? '> ' : '  '}[{item.kind}] {item.name} — {item.state}
          </Text>
        ))}
      </Box>
      {busy && <Text dimColor>working…</Text>}
      {message && <Text color="yellow">{message}</Text>}
    </Box>
  );
}
