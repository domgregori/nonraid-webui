import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { config } from '../config.js';
import type { DockerClient, DockerCommandResult, DockerContainerSummary } from '../docker/index.js';
import { HttpError } from '../httpError.js';
import type { CaFeedStore } from './feedStore.js';
import type {
  AppListQuery,
  AppSort,
  AppSummary,
  CaApp,
  CaConfigEntry,
  InstalledInfo,
  InstallPlan,
  InstallRequest,
  PlanBind,
  PlanDevice,
  PlanEnvVar,
  PlanPortBinding,
} from './types.js';

const OVERVIEW_SUMMARY_LENGTH = 220;

// Labels stamped on every container this feature creates, so a later catalog
// load can recognize "this container came from installing that template" —
// matching by image string alone would be ambiguous (shared base images,
// registry-prefix differences) and wouldn't survive the user renaming the
// container.
const APP_NAME_LABEL = 'com.nonraid.apps.name';
const APP_REPOSITORY_LABEL = 'com.nonraid.apps.repository';

function toSummary(app: CaApp, installedContainer: DockerContainerSummary | undefined): AppSummary {
  const overview = (app.Overview ?? '').replace(/\s+/g, ' ').trim();
  const installed: InstalledInfo | null = installedContainer
    ? {
        containerId: installedContainer.id,
        containerName: installedContainer.name,
        state: installedContainer.state,
        installedRepository: installedContainer.labels[APP_REPOSITORY_LABEL] ?? installedContainer.image,
        updateAvailable: (installedContainer.labels[APP_REPOSITORY_LABEL] ?? installedContainer.image) !== app.Repository,
      }
    : null;

  return {
    name: app.Name,
    repository: app.Repository,
    icon: app.Icon ?? null,
    overviewShort: overview ? overview.slice(0, OVERVIEW_SUMMARY_LENGTH) : null,
    categories: Array.isArray(app.CategoryList) ? app.CategoryList : [],
    privileged: app.Privileged === 'true',
    installed,
  };
}

/** Keyed by the app-name label so a catalog entry can look itself up in one pass. */
function buildInstalledIndex(containers: DockerContainerSummary[]): Map<string, DockerContainerSummary> {
  const index = new Map<string, DockerContainerSummary>();
  for (const c of containers) {
    const appName = c.labels[APP_NAME_LABEL];
    if (appName) index.set(appName, c);
  }
  return index;
}

/** Missing values sort last, not first — an app the feed has no signal for isn't "trending"/"new". */
function sortApps(apps: CaApp[], sort: AppSort): void {
  if (sort === 'trending') {
    apps.sort((a, b) => (b.trending ?? -Infinity) - (a.trending ?? -Infinity));
  } else if (sort === 'latest') {
    apps.sort((a, b) => (b.LastUpdate ?? 0) - (a.LastUpdate ?? 0));
  } else if (sort === 'new') {
    apps.sort((a, b) => (Date.parse(b.Date ?? '') || 0) - (Date.parse(a.Date ?? '') || 0));
  }
}

/**
 * Resolves an absolute host path against the allowed root directories.
 * Uses path.resolve('/', ...) so `..` segments can't climb out of a root —
 * template-supplied paths are treated as untrusted input, not just UX hints.
 *
 * A string-only check isn't enough: a symlink sitting under an allowed root
 * (e.g. `/mnt/user/someshare/escape -> /etc`) can look compliant while its
 * real mount target is outside every root, and Docker's bind mounts follow
 * host-side symlinks at mount time. So once the string check passes, walk up
 * to the nearest existing ancestor (the target may not exist yet — Docker
 * creates missing bind sources), resolve it through `realpath`, and re-check
 * containment on the real path. Mirrors `browse/paths.ts`'s `resolveExisting`,
 * which does the same thing for file-browser paths.
 */
async function isAllowedPath(hostPath: string, roots: string[]): Promise<boolean> {
  if (!hostPath) return false;

  const normalizedRoots = roots.map((root) => path.resolve('/', root));
  const withinRoots = (candidate: string) =>
    normalizedRoots.some((root) => candidate === root || candidate.startsWith(`${root}/`));

  const resolved = path.resolve('/', hostPath);
  if (!withinRoots(resolved)) return false;

  let probe = resolved;
  for (;;) {
    try {
      const real = await realpath(probe);
      const tail = path.relative(probe, resolved);
      const effective = tail ? path.resolve(real, tail) : real;
      return withinRoots(real) && withinRoots(effective);
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return false; // walked all the way to '/' without finding anything real
      probe = parent;
    }
  }
}

function sanitizeContainerName(raw: string): string {
  const cleaned = raw.trim().replace(/[^a-zA-Z0-9_.-]/g, '-');
  return /^[a-zA-Z0-9]/.test(cleaned) ? cleaned : `app-${cleaned}`;
}

function resolveWebUiTemplate(template: string | undefined, ports: PlanPortBinding[]): string | null {
  if (!template) return null;
  // [IP] is deliberately left for the frontend to fill in with the host it's
  // actually talking to (window.location.hostname) — this backend has no
  // reliable way to know which address the user reaches it on.
  return template.replace(/\[PORT:(\d+)\]/g, (_match, containerPort: string) => {
    const bound = ports.find((p) => String(p.containerPort) === containerPort);
    return bound ? String(bound.hostPort) : containerPort;
  });
}

export class AppsService {
  constructor(
    private feedStore: CaFeedStore,
    private docker: DockerClient,
    private bindRoots: string[] = config.appsBindRoots,
  ) {}

  async listSummaries(query: AppListQuery = {}): Promise<AppSummary[]> {
    const feed = await this.feedStore.getFeed();
    const search = query.search?.trim().toLowerCase();
    const category = query.category?.trim();

    const matched = feed.applist.filter((app) => {
      if (category && !(Array.isArray(app.CategoryList) && app.CategoryList.includes(category))) return false;
      if (search) {
        const haystack = `${app.Name} ${app.Repository} ${app.Overview ?? ''}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });

    if (query.sort) sortApps(matched, query.sort);

    const installedIndex = buildInstalledIndex(await this.docker.listContainers());
    return matched.map((app) => toSummary(app, installedIndex.get(app.Name)));
  }

  async listCategories(): Promise<string[]> {
    const feed = await this.feedStore.getFeed();
    const categories = new Set<string>();
    for (const app of feed.applist) {
      if (Array.isArray(app.CategoryList)) for (const c of app.CategoryList) categories.add(c);
    }
    return [...categories].sort();
  }

  /**
   * `Name` alone isn't a unique key in the real feed (~150 names are shared by
   * more than one template, mostly genuinely different apps) — when `repository`
   * is given, prefer the entry matching both so a duplicate-named card can't
   * silently resolve to the wrong template.
   */
  async getApp(name: string, repository?: string): Promise<CaApp> {
    const feed = await this.feedStore.getFeed();
    const matches = feed.applist.filter((a) => a.Name === name);
    const first = matches[0];
    if (!first) throw new HttpError(404, `App "${name}" not found in the catalog`);
    if (repository) {
      const exact = matches.find((a) => a.Repository === repository);
      if (exact) return exact;
    }
    return first;
  }

  async getFeedMeta(): Promise<{ appCount: number; lastUpdated: string; fetchedAt: number }> {
    const feed = await this.feedStore.getFeed();
    return { appCount: feed.applist.length, lastUpdated: feed.last_updated, fetchedAt: this.feedStore.lastFetchedAt };
  }

  refreshFeed() {
    return this.feedStore.refresh();
  }

  async buildPlan(request: InstallRequest): Promise<InstallPlan> {
    const app = await this.getApp(request.name, request.repository);
    return await this.resolvePlan(app, request);
  }

  /**
   * Rebuilds the plan from `request` (never trusts a client-echoed plan
   * object) so the container that actually gets created always matches what
   * server-side validation just checked — a client can't review one plan and
   * submit a tampered one.
   */
  async install(request: InstallRequest): Promise<{ result: DockerCommandResult; plan: InstallPlan }> {
    const app = await this.getApp(request.name, request.repository);
    const plan = await this.resolvePlan(app, request);

    if (plan.errors.length > 0) {
      throw new HttpError(400, `Cannot install "${app.Name}": ${plan.errors.join('; ')}`);
    }
    if (plan.requiresPrivilegedAck && request.privilegedAck !== true) {
      throw new HttpError(
        400,
        `"${app.Name}" requires elevated host access (${plan.elevatedAccessReasons.join(' ')}). Set privilegedAck: true to confirm and install it.`,
      );
    }

    const result = await this.docker.createContainer({
      name: plan.containerName,
      image: plan.image,
      network: plan.network,
      privileged: plan.privileged,
      env: plan.env.map((e) => `${e.name}=${e.value}`),
      ports: plan.ports.map((p) => ({ containerPort: p.containerPort, protocol: p.protocol, hostPort: p.hostPort })),
      binds: plan.binds.map((b) => `${b.hostPath}:${b.containerPath}${b.readOnly ? ':ro' : ''}`),
      devices: plan.devices.map((d) => ({ hostPath: d.hostPath, containerPath: d.containerPath })),
      labels: { [APP_NAME_LABEL]: app.Name, [APP_REPOSITORY_LABEL]: app.Repository },
    });
    return { result, plan };
  }

  private async resolvePlan(app: CaApp, request: InstallRequest): Promise<InstallPlan> {
    const overrides = request.overrides ?? {};
    const entries: CaConfigEntry[] = Array.isArray(app.Config) ? app.Config : [];
    const errors: string[] = [];

    const ports: PlanPortBinding[] = [];
    const env: PlanEnvVar[] = [];
    const binds: PlanBind[] = [];
    const devices: PlanDevice[] = [];

    for (const entry of entries) {
      const attrs = entry['@attributes'];
      const resolved = overrides[attrs.Target] ?? (entry.value || attrs.Default || '');
      const required = attrs.Required === 'true';

      if (required && resolved.trim() === '' && attrs.Type !== 'Label') {
        errors.push(`"${attrs.Name}" is required`);
      }

      switch (attrs.Type) {
        case 'Port': {
          const containerPort = Number(attrs.Target);
          const hostPort = Number(resolved);
          if (!Number.isInteger(containerPort) || containerPort <= 0 || containerPort > 65535) {
            errors.push(`Port "${attrs.Name}" has an invalid container port (${attrs.Target})`);
            break;
          }
          if (resolved && (!Number.isInteger(hostPort) || hostPort <= 0 || hostPort > 65535)) {
            errors.push(`Port "${attrs.Name}" has an invalid host port (${resolved})`);
            break;
          }
          if (hostPort) {
            ports.push({
              target: attrs.Target,
              label: attrs.Name,
              description: attrs.Description,
              required,
              containerPort,
              hostPort,
              protocol: attrs.Mode === 'udp' ? 'udp' : 'tcp',
            });
          }
          break;
        }
        case 'Variable':
          env.push({
            target: attrs.Target,
            label: attrs.Name,
            description: attrs.Description,
            required,
            name: attrs.Target,
            value: resolved,
            masked: attrs.Mask === 'true',
          });
          break;
        case 'Path': {
          const allowed = !resolved || (await isAllowedPath(resolved, this.bindRoots));
          if (!allowed) {
            errors.push(
              `Path "${attrs.Name}" (${resolved}) is outside the allowed host directories (${this.bindRoots.join(', ')})`,
            );
          }
          if (resolved) {
            binds.push({
              target: attrs.Target,
              label: attrs.Name,
              description: attrs.Description,
              required,
              containerPath: attrs.Target,
              hostPath: resolved,
              readOnly: (attrs.Mode ?? '').toLowerCase() === 'ro',
              allowed,
            });
          }
          break;
        }
        case 'Device': {
          const allowed = !resolved || resolved.startsWith('/dev/');
          if (!allowed) errors.push(`Device "${attrs.Name}" (${resolved}) must be a /dev/ path`);
          if (resolved) {
            devices.push({
              target: attrs.Target,
              label: attrs.Name,
              description: attrs.Description,
              required,
              containerPath: attrs.Target,
              hostPath: resolved,
              allowed,
            });
          }
          break;
        }
        case 'Label':
          break; // informational only — not honored as a container label for v1
      }
    }

    const privileged = app.Privileged === 'true';
    const network = app.Network || 'bridge';
    const containerName = sanitizeContainerName(request.containerName?.trim() || app.Name);

    // A device path like /dev/sda (a whole disk) gives a container full raw
    // read/write access to host storage even without Privileged — and host
    // networking removes network-namespace isolation entirely — so both need
    // the same explicit human confirmation as a privileged container, not
    // just the /dev/ prefix or allowed-roots checks above.
    const elevatedAccessReasons: string[] = [];
    if (privileged) elevatedAccessReasons.push('This template runs a privileged container (full host access).');
    for (const d of devices) {
      if (d.allowed) elevatedAccessReasons.push(`This template passes through host device "${d.hostPath}" directly.`);
    }
    if (network === 'host') elevatedAccessReasons.push('This template uses host networking (no network isolation from the host).');

    return {
      appName: app.Name,
      containerName,
      image: app.Repository,
      network,
      privileged,
      webUi: resolveWebUiTemplate(app.WebUI, ports),
      ports,
      env,
      binds,
      devices,
      errors,
      requiresPrivilegedAck: elevatedAccessReasons.length > 0,
      elevatedAccessReasons,
    };
  }
}
