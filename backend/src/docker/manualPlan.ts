import { computeElevatedAccessReasons, isAllowedBindPath, isAllowedDevicePath, sanitizeContainerName } from './planning.js';
import type { ManualContainerPlan, ManualContainerRequest, ManualPlanBind, ManualPlanDevice } from './types.js';

/**
 * Validates a manually-configured container (Docker tab's Add/Edit dialog) —
 * same shape of checks as Apps' resolvePlan, minus the CA Config-schema
 * resolution step, since a manual container has no template to resolve
 * against: every field is already the literal value the user typed.
 */
export async function buildManualPlan(request: ManualContainerRequest, bindRoots: string[]): Promise<ManualContainerPlan> {
  const errors: string[] = [];

  const image = (request.image ?? '').trim();
  if (!image) errors.push('Image is required');

  const containerName = sanitizeContainerName(request.containerName?.trim() ?? '', 'unnamed');
  if (!request.containerName?.trim()) errors.push('Container name is required');

  const ports = Array.isArray(request.ports) ? request.ports : [];
  for (const p of ports) {
    if (!Number.isInteger(p.containerPort) || p.containerPort <= 0 || p.containerPort > 65535) {
      errors.push(`Invalid container port (${p.containerPort})`);
    }
    if (!Number.isInteger(p.hostPort) || p.hostPort <= 0 || p.hostPort > 65535) {
      errors.push(`Invalid host port (${p.hostPort})`);
    }
  }

  const binds: ManualPlanBind[] = [];
  for (const b of Array.isArray(request.binds) ? request.binds : []) {
    if (!b.hostPath || !b.containerPath) continue;
    const allowed = await isAllowedBindPath(b.hostPath, bindRoots);
    if (!allowed) errors.push(`Volume "${b.hostPath}" is outside the allowed host directories (${bindRoots.join(', ')})`);
    binds.push({ ...b, allowed });
  }

  const devices: ManualPlanDevice[] = [];
  for (const d of Array.isArray(request.devices) ? request.devices : []) {
    if (!d.hostPath || !d.containerPath) continue;
    const allowed = isAllowedDevicePath(d.hostPath);
    if (!allowed) errors.push(`Device "${d.hostPath}" must be a /dev/ path`);
    devices.push({ ...d, allowed });
  }

  const network = request.network?.trim() || 'bridge';
  const elevatedAccessReasons = computeElevatedAccessReasons(
    { privileged: request.privileged, network, allowedDeviceHostPaths: devices.filter((d) => d.allowed).map((d) => d.hostPath) },
    'This container',
  );

  return {
    containerName,
    image,
    network,
    privileged: request.privileged,
    env: (Array.isArray(request.env) ? request.env : []).filter((e) => e.name?.trim()),
    ports,
    binds,
    devices,
    errors,
    requiresPrivilegedAck: elevatedAccessReasons.length > 0,
    elevatedAccessReasons,
  };
}
