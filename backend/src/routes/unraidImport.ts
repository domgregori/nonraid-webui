import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import type { ActivityStore } from '../activity/index.js';
import { APP_NAME_LABEL, APP_REPOSITORY_LABEL, type AppsService } from '../apps/index.js';
import type { DockerClient } from '../docker/index.js';
import { buildManualPlan } from '../docker/manualPlan.js';
import { HttpError } from '../httpError.js';
import type { NmdClient } from '../nmd/index.js';
import type { ShareService } from '../shares/index.js';
import { provisionArrayDir } from '../system/arrayDir.js';
import type { PendingImportUsersStore } from '../users/pendingImportStore.js';
import { extractArchive } from '../unraidImport/archive.js';
import { buildPreview } from '../unraidImport/parser.js';
import type { ParsedDockerContainer, ParsedShare, UnraidImportPreview } from '../unraidImport/types.js';

// This is the raw upload ceiling, before extractArchive() gets a chance to skip anything - and a
// real Unraid config/ directory tarred up whole is a lot bigger than its actual share/user configs
// (a few KB) suggest, because config/plugins/ caches every installed plugin's own package files,
// including every historical version ever downloaded, not just the current one. Confirmed live:
// one real user's config/ came to 311MB, almost entirely plugin packages (see
// isRelevantConfigPath()'s doc comment) - this needs real headroom above that, not just past the
// actual useful content's size, since there's no way to filter an already-built archive before
// the whole thing is uploaded. Folder-picker uploads don't pay this cost at all (see
// ImportUnraidWizard.tsx, which filters file selection client-side before anything is even read),
// this ceiling is really only for archive mode. Still far short of a full flash-drive backup,
// which also carries the multi-hundred-MB kernel/rootfs images (bzimage, bzroot, ...) - so
// pointing someone at that instead of just config/ still fails, now with a clear message instead
// of the raw 500 an uncaught multer error used to produce (see runUpload() below).
const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 5000 } });

/** multer's own errors (file too large, too many files, ...) happen inside its middleware, before
 *  the route handler's own try/catch ever runs - passed to Express's error-handling chain instead,
 *  which without this would fall through to Express's raw default 500. Running it as a plain
 *  function call here, instead of mounting it as route middleware, is what lets this catch that. */
function runUpload(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    upload.array('files')(req, res, (err: unknown) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function uploadErrorMessage(err: unknown): string {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return `One of the uploaded files is larger than the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB limit - upload just the config/ directory, not the whole flash drive backup (which also carries the multi-hundred-MB kernel/rootfs images).`;
  }
  return (err as Error).message;
}

// Same in-memory "preview now, commit shortly after" staging shape as the array import wizard's
// stagedImports (routes/array.ts) - the parsed result, not the raw upload, is what's kept around,
// since re-parsing on commit would just mean carrying the raw files around instead for no benefit.
interface StagedUnraidImport {
  preview: UnraidImportPreview;
  createdAt: number;
}
const stagedImports = new Map<string, StagedUnraidImport>();
const STAGING_TTL_MS = 30 * 60 * 1000;

function sweepStagedImports(): void {
  const cutoff = Date.now() - STAGING_TTL_MS;
  for (const [token, staged] of stagedImports) {
    if (staged.createdAt < cutoff) stagedImports.delete(token);
  }
}

function relativePathFor(rawPaths: unknown, index: number, fallback: string): string {
  if (typeof rawPaths === 'string') {
    try {
      const parsed = JSON.parse(rawPaths);
      if (Array.isArray(parsed) && typeof parsed[index] === 'string') return parsed[index];
    } catch {
      // fall through to the per-file fallback below
    }
  }
  return fallback;
}

// Every share this importer creates spans every current data disk (allDisks: true, same as
// picking "all disks" by hand in the New Share dialog) - the parsed shareInclude/shareExclude
// restriction isn't applied even when it did map cleanly (see ParsedShare.diskRestrictionUnmapped),
// deliberately: getting disk placement wrong is a correctness bug for existing data, not just an
// inconvenience, and none of this user's real shares actually restricted disks anyway. The warning
// this parser already emits for a real, non-empty restriction is enough to tell an admin to double
// check placement themselves - see unraidImport/parser.ts.
function toShareInput(parsed: ParsedShare, currentDataSlots: number[]) {
  return {
    name: parsed.name,
    disks: currentDataSlots,
    allDisks: true,
    allocationMethod: parsed.allocationMethod,
    protocols: ['smb'],
    smb: { public: false },
    description: parsed.comment || undefined,
  };
}

// Maps directly onto ManualContainerRequest (the same shape the Docker tab's own Add Container
// dialog submits) - every field a parsed template carries already has a concrete, resolved value
// (see dockerTemplateParser.ts's own doc comment), so this is a straight field rename, not a plan
// to resolve. autostart is deliberately left off (false, buildManualPlan's own default) - Unraid's
// autostart list lives in a different file this importer doesn't read, so there's nothing honest to
// carry over; the admin can flip it on after import same as any other container.
function toManualContainerRequest(parsed: ParsedDockerContainer) {
  return {
    containerName: parsed.name,
    image: parsed.image,
    network: parsed.network,
    privileged: parsed.privileged,
    env: parsed.env,
    ports: parsed.ports,
    binds: parsed.binds.map((b) => ({ hostPath: b.hostPath, containerPath: b.containerPath, readOnly: b.readOnly })),
    devices: parsed.devices,
  };
}

/**
 * Same recognition a real Community-Applications install gets (see AppsService.install()'s own
 * label block) - without this, an imported container is functionally identical but permanently
 * shows as a plain "manual" container: no icon, no real WebUI resolution (routes/docker.ts's
 * withWebUiUrl falls back to a guessed port), and never flagged by the update checker.
 *
 * Matched on name AND an exact repository match, not name alone - getApp() falls back to the
 * *first* name match when the repository doesn't line up exactly, and the real feed has ~150
 * names shared by genuinely different apps (see AppsService.getApp()'s own doc comment). Linking
 * to the wrong catalog entry on an unattended bulk import would be worse than not linking at all,
 * so a near-miss is left as a plain unlinked container rather than guessed at.
 */
async function resolveAppLabels(apps: AppsService, parsed: ParsedDockerContainer): Promise<Record<string, string>> {
  const app = await apps.getApp(parsed.name, parsed.image).catch(() => null);
  if (!app || app.Repository !== parsed.image) return {};
  return {
    [APP_NAME_LABEL]: app.Name,
    [APP_REPOSITORY_LABEL]: app.Repository,
    ...(app.Icon ? { 'net.unraid.docker.icon': app.Icon } : {}),
  };
}

export function unraidImportRouter(
  nmd: NmdClient,
  shares: ShareService,
  pendingImportUsers: PendingImportUsersStore,
  docker: DockerClient,
  bindRoots: string[],
  activity: ActivityStore,
  apps: AppsService,
): Router {
  const router = Router();

  router.post('/unraid-import/preview', async (req, res) => {
    sweepStagedImports();
    try {
      await runUpload(req, res);
    } catch (err) {
      res.status(400).json({ error: uploadErrorMessage(err) });
      return;
    }
    const files = req.files as Express.Multer.File[] | undefined;
    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No file(s) uploaded.' });
      return;
    }
    try {
      const mode = req.body?.mode === 'archive' ? 'archive' : 'folder';
      const imported =
        mode === 'archive'
          ? await extractArchive(files[0]!.originalname, files[0]!.buffer)
          : files.map((f, i) => ({ relativePath: relativePathFor(req.body?.paths, i, f.originalname), content: f.buffer }));

      const preview = buildPreview(imported);
      stagedImports.set(preview.token, { preview, createdAt: Date.now() });
      res.json(preview);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(400).json({ error: (err as Error).message });
      }
    }
  });

  router.post('/unraid-import/commit-shares', async (req, res) => {
    const token = req.body?.token;
    const shareNames: unknown = req.body?.shareNames;
    if (typeof token !== 'string' || !stagedImports.has(token)) {
      res.status(400).json({ error: 'Unknown or expired import - start the wizard over.' });
      return;
    }
    if (!Array.isArray(shareNames) || shareNames.some((n) => typeof n !== 'string')) {
      res.status(400).json({ error: 'shareNames must be an array of strings.' });
      return;
    }

    let currentDataSlots: number[];
    try {
      currentDataSlots = (await nmd.getStatus()).disks.filter((d) => d.type === 'data').map((d) => d.slot);
    } catch (err) {
      res.status(502).json({ error: `Couldn't read the current array to place shares on: ${(err as Error).message}` });
      return;
    }
    if (currentDataSlots.length === 0) {
      res.status(400).json({ error: 'No data disks in the array yet - import the array first.' });
      return;
    }

    const { preview } = stagedImports.get(token)!;
    const byName = new Map(preview.shares.map((s) => [s.name, s]));
    const failed: { name: string; error: string }[] = [];

    // Names not actually part of this staged import are filtered out up front, before ever
    // reaching createMany() - it has no way to tell "not part of this import" apart from any
    // other creation failure, and this one's cheap enough to catch here instead.
    const inputs: unknown[] = [];
    for (const name of shareNames as string[]) {
      const parsed = byName.get(name);
      if (!parsed) {
        failed.push({ name, error: 'Not part of this import.' });
        continue;
      }
      inputs.push(toShareInput(parsed, currentDataSlots));
    }

    // Streamed as ndjson (same protocol as the Apps/Docker/LXC install routes - see
    // api/progressStream.ts on the frontend) rather than one blocking JSON response: a batch of
    // shares with real pre-existing data can take real minutes (see arrayDir.ts's
    // RECURSIVE_TIMEOUT_MS comment), long enough that a silent blocking POST reads as hung, and the
    // wizard can now show which share is actually being worked on instead of just a generic spinner.
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
    const send = (event: object) => res.write(`${JSON.stringify(event)}\n`);

    try {
      // One ApplyContext build and one smb.conf/exports resync for the whole batch, not one each
      // per share - see ShareService.createMany()'s own doc comment for why that matters at scale.
      const result = await shares.createMany(inputs, (progress) => send({ type: 'progress', ...progress }));
      const created = result.created.map((s) => s.name);
      failed.push(...result.failed);

      // Every user this import found gets queued for the Users page regardless of which shares
      // were actually created above - a user not yet created can still be reviewed and added later
      // (see PendingImportUsersStore), and createUserFromPendingImport() already skips wiring
      // access for any share that doesn't exist by then, so this can't reference something bogus.
      if (preview.users.length > 0) {
        await pendingImportUsers.addMany(
          preview.users.map((u) => ({
            username: u.username,
            readShares: preview.shares.filter((s) => s.readUsers.includes(u.username)).map((s) => s.name),
            writeShares: preview.shares.filter((s) => s.writeUsers.includes(u.username)).map((s) => s.name),
          })),
        );
      }

      // Token deliberately NOT deleted here (only the 30-minute sweep cleans it up) - a wizard
      // session that imports shares and docker containers as two separate steps needs the same
      // token to still be valid for the second commit-docker-containers call.
      send({ type: 'done', result: { created, failed, usersQueued: preview.users.length } });
    } catch (err) {
      // Same rationale as the Apps install route: the response has already started streaming by
      // this point, so a real failure (e.g. buildContext()'s own nmdctl poll failing mid-batch)
      // has to go out as a {type:"error"} event instead of an HTTP error status - the status line
      // and headers are long since committed.
      send({ type: 'error', message: (err as Error).message });
    } finally {
      res.end();
    }
  });

  router.post('/unraid-import/commit-docker-containers', async (req, res) => {
    const token = req.body?.token;
    const containerNames: unknown = req.body?.containerNames;
    if (typeof token !== 'string' || !stagedImports.has(token)) {
      res.status(400).json({ error: 'Unknown or expired import - start the wizard over.' });
      return;
    }
    if (!Array.isArray(containerNames) || containerNames.some((n) => typeof n !== 'string')) {
      res.status(400).json({ error: 'containerNames must be an array of strings.' });
      return;
    }

    const { preview } = stagedImports.get(token)!;
    const byName = new Map(preview.dockerContainers.map((c) => [c.name, c]));
    const failed: { name: string; error: string }[] = [];
    const targets: ParsedDockerContainer[] = [];
    for (const name of containerNames as string[]) {
      const parsed = byName.get(name);
      if (!parsed) {
        failed.push({ name, error: 'Not part of this import.' });
        continue;
      }
      targets.push(parsed);
    }

    res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
    const send = (event: object) => res.write(`${JSON.stringify(event)}\n`);

    // Best-effort per container, same as commit-shares - one bad template (or one that needs
    // elevated access this bulk import isn't willing to auto-grant, see requiresPrivilegedAck
    // below) shouldn't stop the rest of the batch from installing. Deliberately sequential rather
    // than parallel: each createContainer() pulls its own image, and running several multi-hundred-
    // MB pulls at once would mostly just contend for the same network/disk bandwidth.
    const created: string[] = [];
    const skipped: string[] = [];
    try {
      // A name already running/stopped under Docker is skipped outright, not attempted and left to
      // fail on Docker's own "name already in use" - re-running the same import (e.g. after picking
      // a few containers, then coming back for the rest) shouldn't re-report every earlier one as a
      // failure. Fetched once up front rather than per container - a batch import is exactly the
      // case a single listContainers() call amortizes best.
      const existingNames = new Set((await docker.listContainers()).map((c) => c.name));

      for (const [index, parsed] of targets.entries()) {
        send({ type: 'progress', name: parsed.name, index, total: targets.length });
        if (existingNames.has(parsed.name)) {
          skipped.push(parsed.name);
          continue;
        }
        try {
          const plan = await buildManualPlan(toManualContainerRequest(parsed), bindRoots);
          if (plan.errors.length > 0) throw new Error(plan.errors.join('; '));
          // Never auto-grant elevated host access on a bulk import - same gate a single manual
          // container creation enforces (routes/docker.ts requires an explicit privilegedAck in the
          // request body). An admin who wants this container privileged can recreate it by hand
          // with that acknowledged deliberately, not as a side effect of importing a whole batch.
          if (plan.requiresPrivilegedAck) {
            throw new Error(`Needs elevated host access (${plan.elevatedAccessReasons.join(' ')}) - recreate it manually via Add Container to confirm that.`);
          }
          for (const bind of plan.binds) {
            if (bind.allowed) await provisionArrayDir(bind.hostPath);
          }
          await docker.createContainer(
            {
              name: plan.containerName,
              image: plan.image,
              network: plan.network,
              privileged: plan.privileged,
              env: plan.env.map((e) => `${e.name}=${e.value}`),
              ports: plan.ports,
              binds: plan.binds.map((b) => `${b.hostPath}:${b.containerPath}${b.readOnly ? ':ro' : ''}`),
              devices: plan.devices.map((d) => ({ hostPath: d.hostPath, containerPath: d.containerPath })),
              labels: await resolveAppLabels(apps, parsed),
              autostart: false,
            },
            // Forwarded on top of the coarse per-container tick above, tagged with the same
            // name/index/total - a real image pull can sit on one layer for a while, and the
            // coarse tick alone left the wizard looking stalled for as long as that took (see
            // InstallProgress.tsx's own log for how the Apps/Docker single-container dialogs
            // already avoid exactly this by showing real per-layer status instead of a bare spinner).
            (p) => send({ type: 'progress', name: parsed.name, index, total: targets.length, ...p }),
          );
          created.push(parsed.name);
          activity.log(`Container "${parsed.name}" imported from Unraid`, 'green').catch(() => {});
        } catch (err) {
          failed.push({ name: parsed.name, error: (err as Error).message });
        }
      }
      send({ type: 'done', result: { created, skipped, failed } });
    } catch (err) {
      send({ type: 'error', message: (err as Error).message });
    } finally {
      res.end();
    }
  });

  return router;
}
