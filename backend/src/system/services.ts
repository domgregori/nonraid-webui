import { runSudoMaybe, spawnMaybeSudo } from './procUtil.js';

export type ServiceId = 'docker' | 'lxc' | 'smb' | 'nfs' | 'ssh';

export type ServiceState = 'active' | 'inactive' | 'failed' | 'mixed';

export interface ServiceDef {
  id: ServiceId;
  label: string;
  /** Units passed to `systemctl is-active` for this service's status. */
  statusUnits: string[];
  /** Units/aliases passed to `systemctl stop`. */
  stopArgs: string[];
  /** Units/aliases passed to `systemctl start`. */
  startArgs: string[];
}

// Argv shapes below are deliberately picked to match real precedent elsewhere in this codebase
// rather than inventing new ones: docker's stop/start args are exactly what
// routes/array.ts (driver-reload) and docker/storagePath.ts already use; lxc's unit name matches
// the recovery command already documented for this rig.
export const SERVICE_DEFS: ServiceDef[] = [
  { id: 'docker', label: 'Docker', statusUnits: ['docker.service'], stopArgs: ['docker.socket', 'docker.service'], startArgs: ['docker'] },
  { id: 'lxc', label: 'LXC', statusUnits: ['lxc.service'], stopArgs: ['lxc'], startArgs: ['lxc'] },
  {
    id: 'smb',
    label: 'SMB Sharing',
    // winbind is deliberately not included: it's only relevant for AD-domain-joined Samba, which
    // this app never sets up (install-webui.sh only enables smbd/nmbd, see its own systemctl
    // enable --now line) — with it included here, a fully healthy standalone install permanently
    // reported 'mixed' ("Partially running") since winbind.service is never active.
    statusUnits: ['smbd.service', 'nmbd.service'],
    stopArgs: ['smbd.service', 'nmbd.service'],
    startArgs: ['smbd.service', 'nmbd.service'],
  },
  { id: 'nfs', label: 'NFS Sharing', statusUnits: ['nfs-server.service'], stopArgs: ['nfs-server'], startArgs: ['nfs-server'] },
  { id: 'ssh', label: 'SSH', statusUnits: ['ssh.service'], stopArgs: ['ssh'], startArgs: ['ssh'] },
];

/**
 * `systemctl is-active` exits non-zero for inactive/failed units — an expected, normal outcome
 * here, not a real failure — so this collects stdout itself instead of using runSudoMaybe (which
 * would discard stdout and reject on that exit code).
 */
function isActive(units: string[], useSudo: boolean): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawnMaybeSudo('systemctl', ['is-active', ...units], useSudo);
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', (err) => reject(err));
    child.on('close', () => resolve(stdout.split('\n').map((line) => line.trim()).filter(Boolean)));
  });
}

export async function getServiceState(def: ServiceDef, useSudo: boolean): Promise<ServiceState> {
  const lines = await isActive(def.statusUnits, useSudo);
  if (lines.length > 0 && lines.every((l) => l === 'active')) return 'active';
  if (lines.some((l) => l === 'failed')) return 'failed';
  if (lines.length > 0 && lines.every((l) => l === 'inactive')) return 'inactive';
  return 'mixed';
}

export function startService(def: ServiceDef, useSudo: boolean): Promise<{ stdout: string; stderr: string }> {
  return runSudoMaybe('systemctl', ['start', ...def.startArgs], useSudo);
}

export function stopService(def: ServiceDef, useSudo: boolean): Promise<{ stdout: string; stderr: string }> {
  return runSudoMaybe('systemctl', ['stop', ...def.stopArgs], useSudo);
}

// Sequential stop-then-start, reusing the same argv shapes as startService/stopService, rather
// than trusting `systemctl restart <multiple units>` ordering semantics for multi-unit groups
// like smb.
export async function restartService(def: ServiceDef, useSudo: boolean): Promise<void> {
  await stopService(def, useSudo);
  await startService(def, useSudo);
}
