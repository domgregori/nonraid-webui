import { runSudoMaybe, spawnMaybeSudo } from './procUtil.js';

export type ServiceId = 'docker' | 'lxc' | 'smb' | 'nfs' | 'ssh' | 'avahi' | 'tailscale' | 'rclone-rcd';

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
    // enable --now line) - with it included here, a fully healthy standalone install permanently
    // reported 'mixed' ("Partially running") since winbind.service is never active.
    statusUnits: ['smbd.service', 'nmbd.service'],
    stopArgs: ['smbd.service', 'nmbd.service'],
    startArgs: ['smbd.service', 'nmbd.service'],
  },
  { id: 'nfs', label: 'NFS Sharing', statusUnits: ['nfs-server.service'], stopArgs: ['nfs-server'], startArgs: ['nfs-server'] },
  { id: 'ssh', label: 'SSH', statusUnits: ['ssh.service'], stopArgs: ['ssh'], startArgs: ['ssh'] },
  // mDNS/DNS-SD - lets SMB shares show up in network-browse UIs (Finder, GNOME Files) as
  // "<hostname>.local" without depending on the router's own DNS. install-webui.sh installs
  // avahi-daemon and drops in the Samba service-type file that actually advertises the shares;
  // this entry just gives the daemon itself the same start/stop/restart/status row as everything
  // else here.
  { id: 'avahi', label: 'Avahi/mDNS', statusUnits: ['avahi-daemon.service'], stopArgs: ['avahi-daemon'], startArgs: ['avahi-daemon'] },
  { id: 'tailscale', label: 'Tailscale', statusUnits: ['tailscaled.service'], stopArgs: ['tailscaled'], startArgs: ['tailscaled'] },
  // rclone's own RC daemon backing Remote Backup - always listed, same as every other row here,
  // regardless of whether settings.remoteBackup.enabled is on.
  { id: 'rclone-rcd', label: 'Remote Backup (rclone)', statusUnits: ['rclone-rcd.service'], stopArgs: ['rclone-rcd'], startArgs: ['rclone-rcd'] },
];

/**
 * `systemctl is-active` exits non-zero for inactive/failed units - an expected, normal outcome
 * here, not a real failure - so this collects stdout itself instead of using runSudoMaybe (which
 * would discard stdout and reject on that exit code).
 */
function isActive(units: string[]): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawnMaybeSudo('systemctl', ['is-active', ...units]);
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', (err) => reject(err));
    child.on('close', () => resolve(stdout.split('\n').map((line) => line.trim()).filter(Boolean)));
  });
}

export async function getServiceState(def: ServiceDef): Promise<ServiceState> {
  const lines = await isActive(def.statusUnits);
  if (lines.length > 0 && lines.every((l) => l === 'active')) return 'active';
  if (lines.some((l) => l === 'failed')) return 'failed';
  if (lines.length > 0 && lines.every((l) => l === 'inactive')) return 'inactive';
  return 'mixed';
}

export function startService(def: ServiceDef): Promise<{ stdout: string; stderr: string }> {
  return runSudoMaybe('systemctl', ['start', ...def.startArgs]);
}

export function stopService(def: ServiceDef): Promise<{ stdout: string; stderr: string }> {
  return runSudoMaybe('systemctl', ['stop', ...def.stopArgs]);
}

// Sequential stop-then-start, reusing the same argv shapes as startService/stopService, rather
// than trusting `systemctl restart <multiple units>` ordering semantics for multi-unit groups
// like smb.
export async function restartService(def: ServiceDef): Promise<void> {
  await stopService(def);
  await startService(def);
}

// SSH-specific boot-enable, distinct from the generic start/stop above (is it running right now)
// - this is "should it come back after a reboot", same concept as TailscaleSettings.enabled, but
// deliberately NOT mirrored into settings.json: unlike Tailscale, systemd itself is already the
// only source of truth here (`systemctl is-enabled` answers this directly), so shadowing it in a
// second place would just be one more thing that could drift. Kept SSH-specific rather than
// generalized onto ServiceDef since no other service needs this yet - see the "System" card's SSH
// tasks this was built for.
export async function isSshEnabled(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const child = spawnMaybeSudo('systemctl', ['is-enabled', 'ssh']);
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', (err) => reject(err));
    // Same non-zero-is-not-a-failure handling as isActive() above - "disabled"/"static"/"masked"
    // are all valid answers, not errors.
    child.on('close', () => resolve(stdout.trim() === 'enabled'));
  });
}

// Enabling also starts it immediately (--now) - no reason to make someone wait for a reboot to
// actually get SSH access. Disabling deliberately does NOT stop it right now: this toggle is
// "should it come back after a reboot", not "kill it this instant" - the admin flipping it is
// quite possibly connected over the very session it would drop. Use the Stop button below (which
// already carries its own explicit warning) for that.
export function setSshEnabled(enabled: boolean): Promise<{ stdout: string; stderr: string }> {
  return runSudoMaybe('systemctl', enabled ? ['enable', '--now', 'ssh'] : ['disable', 'ssh']);
}
