---
name: project-shared-package-resolution
description: How apps/api consumes @probooks/shared across the ADR-0003 Node-resolution split (typecheck/build vs jest)
metadata:
  type: project
---

`@probooks/shared` must be consumed two different ways because of ADR-0003 (apps/api uses `moduleResolution: Node` for NestJS, while base is NodeNext).

**Decision (Wave 1, 2026-06-04):** `packages/shared/package.json` exposes `main`/`types`/`exports` pointing at built `dist/` (not `src/`), so apps/api `tsc` and `nest build` resolve it under classic Node resolution. Turbo's `^build` (in turbo.json `dependsOn`) builds shared before api typecheck/test/build.

For Jest (which does NOT run turbo `^build`), apps/api `package.json` jest config maps:
- `^@probooks/shared$` → `<rootDir>/../../../packages/shared/src/index.ts` (rootDir is `src`), and
- `^(\\.{1,2}/.*)\\.js$` → `$1` so ts-jest resolves shared's ESM-style `.js` relative imports back to `.ts` source.

**Why:** shared dist is ESM (`"type": "module"`); Jest runs CommonJS and won't transform node_modules, so it must compile shared from source instead.

**How to apply:** When a new package under `packages/` is imported by apps/api, give it the same dist-pointing `exports` and add a jest `moduleNameMapper` entry. Do not change apps/api back to NodeNext (breaks Nest DI per ADR-0003). See [[project-wave1-foundation-modules]].
