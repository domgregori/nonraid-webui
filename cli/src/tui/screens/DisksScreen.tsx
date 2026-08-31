import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ApiClient } from '../../api/client.js';
import type { CommandResult, NmdDisk, SmartHealth, SmartSpinState } from '../../api/types.js';
import { formatBytes } from '../format.js';
import { StatusLine } from '../StatusLine.js';
import { useListNav } from '../useListNav.js';
import { usePolling } from '../usePolling.js';

interface Props {
  client: ApiClient;
}

interface DiskRow extends NmdDisk {
  spinState: SmartSpinState | null;
  health: SmartHealth | null;
  tempCelsius: number | null;
}

async function loadDisks(client: ApiClient): Promise<DiskRow[]> {
  const [status, spinStates, health, temps] = await Promise.all([
    client.get<{ disks: NmdDisk[] }>('/status'),
    client.get<Record<string, SmartSpinState>>('/smart/spin-states').catch((): Record<string, SmartSpinState> => ({})),
    client.get<Record<string, SmartHealth | null>>('/smart/health').catch((): Record<string, SmartHealth | null> => ({})),
    client.get<Record<string, number | null>>('/smart/temperatures').catch((): Record<string, number | null> => ({})),
  ]);
  return status.disks
    .filter((d) => d.device && d.device !== 'none')
    .map((d) => ({ ...d, spinState: spinStates[d.device] ?? null, health: health[d.device] ?? null, tempCelsius: temps[d.device] ?? null }));
}

export function DisksScreen({ client }: Props) {
  const { data: disks, error, refresh } = usePolling(() => loadDisks(client));
  const [selected] = useListNav(disks?.length ?? 0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const toggleSpin = async (disk: DiskRow) => {
    setBusy(true);
    setMessage(null);
    const action = disk.spinState === 'standby' ? 'spin-up' : 'spin-down';
    try {
      const result = await client.post<CommandResult>(`/disks/${disk.slot}/${action}`);
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
    if (input === 's' && !busy && disks?.[selected]) void toggleSpin(disks[selected]);
  });

  return (
    <Box flexDirection="column">
      <Text underline>Disks ({disks?.length ?? 0}) — ↑/↓ select, s spin up/down, r refresh</Text>
      {disks?.length === 0 && <Text dimColor>none</Text>}
      {disks?.map((d, i) => (
        <Text key={d.slot} color={i === selected ? 'cyan' : undefined}>
          {i === selected ? '▶ ' : '  '}
          slot {d.slot} {d.device.padEnd(10)} {d.type.padEnd(6)} {formatBytes(d.size_gb * 1024 ** 3).padStart(9)} {d.status.padEnd(16)}{' '}
          {d.spinState ?? '-'} {d.health ?? '-'} {d.tempCelsius !== null ? `${d.tempCelsius}°C` : ''}
        </Text>
      ))}
      <Box marginTop={1}>
        <StatusLine error={error} message={message} busy={busy} />
      </Box>
    </Box>
  );
}
