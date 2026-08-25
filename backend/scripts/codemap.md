# backend/scripts/

## Responsibility
Build-time helper that bakes build metadata into a generated source file so the installed deployment can report its exact revision.

## Design
- `gen-build-info.mjs` — runs `git rev-parse --short HEAD` and writes `backend/src/buildInfo.generated.ts` exporting `BUILD_HASH: string | null`. Falls back to `null` when `.git` is absent (tarball checkout), matching previous runtime behavior. Uses `execSync` with `stdio: ['ignore','pipe','ignore']`.

## Flow
Hooked as `predev`/`prebuild`/`pretypecheck` in `backend/package.json`, so every build/typecheck regenerates `src/buildInfo.generated.ts` (which is gitignored) before `tsc` runs.

## Integration
- Consumed by the backend build pipeline (`backend/package.json` scripts).
- Output `src/buildInfo.generated.ts` is imported by the backend to expose the build hash (e.g. in the settings/status surface). Not shipped as source — regenerated per build.
