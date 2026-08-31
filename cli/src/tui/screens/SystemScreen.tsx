import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ApiClient } from '../../api/client.js';
import type { CommandResult, ServiceRow, SystemStats } from '../../api/types.js';
import { formatBytes, formatPercent, formatUptime } from '../format.js';
import { StatusLine } from '../StatusLine.js';
import { useListNav } from '../useListNav.js';
import { usePolling } from '../usePolling.js';

interface Props {
  client: ApiClient;
}

async function load(client: ApiClient): Promise<{ stats: SystemStats; services: ServiceRow[] }> {
  const [stats, services] = await Promise.all([client.get<SystemStats>('/system'), client.get<ServiceRow[]>('/services')]);
  return { stats, services };
}

const STATE_COLOR: Record<ServiceRow['state'], string | undefined> = { active: 'green', inactive: undefined, failed: 'red', mixed: 'yellow' };

// Host info is read-only here (reboot/hostname/timezone changes stay CLI-only, `nonraid-tool
// system ...` - too disruptive/multi-step for a single keypress). Services get the same
// start/stop-toggle action pattern as Docker/LXC; `restart` stays CLI-only (`nonraid-tool service
// restart <id>`) since one key can't cleanly express three actions.
export function SystemScreen({ client }: Props) {
  const { data, error, refresh } = usePolling(() => load(client));
  const [selected] = useListNav(data?.services.length ?? 0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const toggle = async (svc: ServiceRow) => {
    setBusy(true);
    setMessage(null);
    const action = svc.state === 'active' ? 'stop' : 'start';
    try {
      const result = await client.post<CommandResult>(`/services/${encodeURIComponent(svc.id)}/${action}`);
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
    if (input === 's' && !busy && data?.services[selected]) void toggle(data.services[selected]);
  });

  const s = data?.stats;

  return (
    <Box flexDirection="column">
      <Text underline>System — ↑/↓ select service, s start/stop, r refresh</Text>
      {s && (
        <Box marginTop={1} flexDirection="column">
          <Text>
            {s.hostname} · up {formatUptime(s.uptimeSeconds)} · {s.version}
          </Text>
          <Text dimColor>
            cpu {formatPercent(s.cpuPercent)}
            {s.cpuTempCelsius !== null ? ` (${s.cpuTempCelsius}°C)` : ''} · mem {formatBytes(s.memUsedBytes)}/{formatBytes(s.memTotalBytes)}
          </Text>
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        <Text bold>Services ({data?.services.length ?? 0})</Text>
        {data?.services.map((svc, i) => (
          <Text key={svc.id} color={i === selected ? 'cyan' : STATE_COLOR[svc.state]}>
            {i === selected ? '▶ ' : '  '}
            {svc.label.padEnd(24)} {svc.state}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <StatusLine error={error} message={message} busy={busy} />
      </Box>
    </Box>
  );
}
