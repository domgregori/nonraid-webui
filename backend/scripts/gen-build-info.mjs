// Bakes the current commit's short hash, and (if HEAD is exactly at one) its release tag, into a
// generated source file at build time, since the installed deployment (tools/install-webui.sh
// rsyncs only backend/dist/, never .git) has no git history to query at runtime. Both fall back to
// null when .git isn't available (e.g. a tarball checkout) or, for the tag, when this build was
// made from an arbitrary commit rather than a tagged release - see backend/src/update/service.ts,
// which uses BUILD_TAG (not BUILD_HASH) to decide whether this install is on a real release.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const cwd = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(cwd, '..', 'src', 'buildInfo.generated.ts');

let hash = null;
try {
  hash = execSync('git rev-parse --short HEAD', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
} catch {
  // not a git checkout - leave hash as null
}

let tag = null;
try {
  // --exact-match only succeeds when HEAD is literally at a tag, not "N commits past the nearest
  // one" (its default behavior) - anything else means this build isn't a tagged release.
  tag = execSync('git describe --tags --exact-match', { cwd, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
} catch {
  // HEAD isn't at a tag (or not a git checkout at all) - leave tag as null
}

writeFileSync(
  outFile,
  `export const BUILD_HASH: string | null = ${hash ? `'${hash}'` : 'null'};\n` + `export const BUILD_TAG: string | null = ${tag ? `'${tag}'` : 'null'};\n`,
);
