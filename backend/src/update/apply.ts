import { spawnMaybeSudo } from '../system/procUtil.js';
import { config } from '../config.js';

const OUTPUT_TAIL_LINES = 200;

export interface ApplyResult {
  ok: boolean;
  message: string;
  /** Last OUTPUT_TAIL_LINES lines of the install-webui.sh run's combined stdout+stderr - the
   *  full log already goes to its own file (see install-webui.sh's setup_logging()), this is
   *  just enough to explain a failure inline without shipping the whole run to the browser. */
  output: string;
}

/** Runs each group of --step names as its own separate install-webui.sh invocation, in order,
 *  stopping at the first failure. Required because install-webui.sh's own step runner always
 *  executes every requested name from its STEPS array first (in that array's declared order),
 *  then every requested SHORTCUTS name after - regardless of the order given on the command line
 *  (confirmed live: a single call mixing `update_script`, a SHORTCUT, with STEPS names ran the
 *  STEPS ones first and update_script dead last, building against the *old* checkout). Each group
 *  passed here must already be safe to run together in one call - i.e. either all STEPS names (in
 *  their own correct relative order) or a single SHORTCUT alone. */
async function runInstallScriptGroups(groups: string[][]): Promise<ApplyResult> {
  let output = '';
  for (const steps of groups) {
    const result = await runInstallScript(steps);
    output += result.output;
    if (!result.ok) return { ...result, output: output.split('\n').slice(-OUTPUT_TAIL_LINES).join('\n') };
  }
  return { ok: true, message: 'Update applied successfully.', output: output.split('\n').slice(-OUTPUT_TAIL_LINES).join('\n') };
}

function runInstallScript(steps: string[]): Promise<ApplyResult> {
  return new Promise((resolve) => {
    const args = steps.flatMap((step) => ['--step', step]);
    const child = spawnMaybeSudo(config.updateInstallScriptPath, args);
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.on('error', (err) => {
      resolve({ ok: false, message: `Could not start install-webui.sh: ${err.message}`, output });
    });
    child.on('close', (code) => {
      const tail = output.split('\n').slice(-OUTPUT_TAIL_LINES).join('\n');
      if (code === 0) {
        resolve({ ok: true, message: 'Update applied successfully.', output: tail });
      } else {
        resolve({ ok: false, message: `install-webui.sh exited with code ${code}`, output: tail });
      }
    });
  });
}

// Deliberately excludes restart_webui/start_services (and the update_backend/update_frontend
// shortcuts, which end by calling those) - a `systemctl restart nonraid-webui` issued by a child
// of this very unit's own process is exactly the shape the rest of this codebase avoids (see
// routes/update.ts's own comment on why applyWebuiUpdate()'s caller does the restart itself
// instead, the same way routes/system.ts's restart-services route does). This only builds and
// stages the new code; the caller restarts once this resolves ok.
//
// install_system_packages and pin_kernel_minor are included here (not just in a full install run)
// for the same reason: a release that bumps a package version this app cares about (a security fix
// in apprise, say - install_system_packages's own apt-get install re-resolves to whatever's newest
// in the repo, no per-package code needed) or KERNEL_TARGET_MINOR (tools/install-webui.sh) should
// apply that to every already-installed system the moment its admin updates the webui, not just on
// a fresh install. This is only as fast as the underlying distro's own package repo, though - if a
// fix hasn't landed there yet, re-running this does nothing until it has.
export function applyWebuiUpdate(): Promise<ApplyResult> {
  return runInstallScriptGroups([
    ['snapshot_before_update'],
    ['update_script'], // a SHORTCUT - must run alone, before the STEPS group below, so the build
    // actually picks up what this just pulled (see runInstallScriptGroups's own comment).
    ['install_system_packages', 'build_backend', 'build_frontend', 'stage_install', 'pin_kernel_minor'],
  ]);
}

// update_driver only rebuilds/installs the kernel module via DKMS - it never touches the *live*
// loaded module (see tools/install-webui.sh's own comment on that shortcut), so this is safe to
// run regardless of array state and never needs a restart of anything. snapshot_before_update
// still runs first for the same reason it does on the webui path - a bad driver build/DKMS
// install shouldn't be unrecoverable. A single runInstallScript call is enough here (unlike
// applyWebuiUpdate): snapshot_before_update is a STEPS name and update_driver is a SHORTCUT, and
// the runner always executes STEPS before SHORTCUTS regardless of call order (see
// runInstallScriptGroups's own comment) - which happens to already be the order wanted.
export function applyDriverUpdate(): Promise<ApplyResult> {
  return runInstallScript(['snapshot_before_update', 'update_driver']);
}
