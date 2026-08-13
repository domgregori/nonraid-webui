import type { ActivityStore } from '../activity/index.js';
import { config } from '../config.js';
import type { CreateContainerProgressCallback, DockerClient, DockerCommandResult, DockerContainerSummary } from '../docker/index.js';
import { computeElevatedAccessReasons, isAllowedBindPath, isAllowedDevicePath, sanitizeContainerName } from '../docker/planning.js';
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
import { resolveWebUiTemplate } from './webUi.js';

const OVERVIEW_SUMMARY_LENGTH = 220;

// Labels stamped on every container this feature creates, so a later catalog
// load can recognize "this container came from installing that template" -
// matching by image string alone would be ambiguous (shared base images,
// registry-prefix differences) and wouldn't survive the user renaming the
// container. Exported so routes/docker.ts can recognize the same containers
// (e.g. to resolve their WebUI link from the CA template rather than a
// generic "first published port" guess).
export const APP_NAME_LABEL = 'com.nonraid.apps.name';
export const APP_REPOSITORY_LABEL = 'com.nonraid.apps.repository';

function toSummary(app: CaApp, installedContainer: DockerContainerSummary | undefined): AppSummary {
  // Fields typed as string on CaApp aren't actually guaranteed to be one at
  // runtime - the feed is converted from community-maintained XML, and some
  // templates genuinely nest a field instead of using plain text (e.g. a
  // real one has Maintainer: { WebPage: "..." } instead of a string). This
  // runs once per catalog entry for every /apps list request, so a `string`
  // method call on the wrong type here would 500 the whole listing, not
  // just one app's detail view.
  const overview = (typeof app.Overview === 'string' ? app.Overview : '').replace(/\s+/g, ' ').trim();
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

/** Missing values sort last, not first - an app the feed has no signal for isn't "trending"/"new". */
function sortApps(apps: CaApp[], sort: AppSort): void {
  if (sort === 'trending') {
    apps.sort((a, b) => (b.trending ?? -Infinity) - (a.trending ?? -Infinity));
  } else if (sort === 'latest') {
    apps.sort((a, b) => (b.LastUpdate ?? 0) - (a.LastUpdate ?? 0));
  } else if (sort === 'new') {
    apps.sort((a, b) => (Date.parse(b.Date ?? '') || 0) - (Date.parse(a.Date ?? '') || 0));
  }
}


export class AppsService {
  constructor(
    private feedStore: CaFeedStore,
    private docker: DockerClient,
    private activity: ActivityStore,
    private bindRoots: string[] = config.appsBindRoots,
  ) {}

  /**
   * The feed mixes real Docker apps with actual Unraid *plugins* (.plg/.txz
   * packages installed outside Docker entirely - their `Repository` is a
   * .plg URL, not an image). There's no framework in this project for
   * installing plugins, so they're excluded here, once, rather than filtered
   * ad hoc in each caller - every other method reads the feed through this.
   */
  private async applications(): Promise<CaApp[]> {
    const feed = await this.feedStore.getFeed();
    return feed.applist.filter((app) => app.Plugin !== true);
  }

  async listSummaries(query: AppListQuery = {}): Promise<AppSummary[]> {
    const applications = await this.applications();
    const search = query.search?.trim().toLowerCase();
    const category = query.category?.trim();

    const matched = applications.filter((app) => {
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
    const applications = await this.applications();
    const categories = new Set<string>();
    for (const app of applications) {
      if (Array.isArray(app.CategoryList)) for (const c of app.CategoryList) categories.add(c);
    }
    return [...categories].sort();
  }

  /**
   * `Name` alone isn't a unique key in the real feed (~150 names are shared by
   * more than one template, mostly genuinely different apps) - when `repository`
   * is given, prefer the entry matching both so a duplicate-named card can't
   * silently resolve to the wrong template.
   */
  async getApp(name: string, repository?: string): Promise<CaApp> {
    const matches = (await this.applications()).filter((a) => a.Name === name);
    const first = matches[0];
    if (!first) throw new HttpError(404, `App "${name}" not found in the catalog`);
    if (repository) {
      const exact = matches.find((a) => a.Repository === repository);
      if (exact) return exact;
    }
    return first;
  }

  async getFeedMeta(): Promise<{ appCount: number; lastUpdated: string; fetchedAt: number }> {
    const [feed, applications] = await Promise.all([this.feedStore.getFeed(), this.applications()]);
    return { appCount: applications.length, lastUpdated: feed.last_updated, fetchedAt: this.feedStore.lastFetchedAt };
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
   * server-side validation just checked - a client can't review one plan and
   * submit a tampered one.
   */
  async install(
    request: InstallRequest,
    onProgress?: CreateContainerProgressCallback,
  ): Promise<{ result: DockerCommandResult; plan: InstallPlan }> {
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

    const result = await this.docker.createContainer(
      {
        name: plan.containerName,
        image: plan.image,
        network: plan.network,
        privileged: plan.privileged,
        env: plan.env.map((e) => `${e.name}=${e.value}`),
        ports: plan.ports.map((p) => ({ containerPort: p.containerPort, protocol: p.protocol, hostPort: p.hostPort })),
        binds: plan.binds.map((b) => `${b.hostPath}:${b.containerPath}${b.readOnly ? ':ro' : ''}`),
        devices: plan.devices.map((d) => ({ hostPath: d.hostPath, containerPath: d.containerPath })),
        labels: {
          [APP_NAME_LABEL]: app.Name,
          [APP_REPOSITORY_LABEL]: app.Repository,
          // Same label convention real Unraid's dashboard reads directly off any
          // container - stamping it here means our own catalog installs show a
          // real icon on the dashboard without needing a runtime catalog lookup.
          ...(app.Icon ? { 'net.unraid.docker.icon': app.Icon } : {}),
        },
      },
      onProgress,
    );
    this.activity.log(`Installed "${app.Name}" from Community Applications`, 'green').catch(() => {});
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
          const allowed = !resolved || (await isAllowedBindPath(resolved, this.bindRoots));
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
          const allowed = !resolved || isAllowedDevicePath(resolved);
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
          break; // informational only - not honored as a container label for v1
      }
    }

    const privileged = app.Privileged === 'true';
    const network = app.Network || 'bridge';
    const containerName = sanitizeContainerName(request.containerName?.trim() || app.Name, app.Name);

    const elevatedAccessReasons = computeElevatedAccessReasons(
      { privileged, network, allowedDeviceHostPaths: devices.filter((d) => d.allowed).map((d) => d.hostPath) },
      'This template',
    );

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
