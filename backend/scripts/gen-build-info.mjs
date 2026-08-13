// Bakes the current commit's short hash into a generated source file at build time, since the
// installed deployment (tools/install-webui.sh rsyncs only backend/dist/, never .git) has no git
// history to query at runtime. Falls back to null when .git isn't available (e.g. a tarball
// checkout), matching the previous runtime behavior.
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const outFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'buildInfo.generated.ts');

let hash = null;
try {
  hash = execSync('git rev-parse --short HEAD', { cwd: path.dirname(fileURLToPath(import.meta.url)), stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
} catch {
  // not a git checkout - leave hash as null
}

writeFileSync(outFile, `export const BUILD_HASH: string | null = ${hash ? `'${hash}'` : 'null'};\n`);
