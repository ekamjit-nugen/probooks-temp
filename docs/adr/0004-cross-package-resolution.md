# ADR-0004: Cross-package resolution for @probooks/shared

- **Status:** Accepted (2026-06-04)
- **Context:** `apps/api` (CommonJS/Jest per ADR-0003) consumes `@probooks/shared`
  (ESM, `type: module`). Three consumers resolve it differently: `tsc`
  typecheck and `nest build` use the package `exports` → `dist` (so shared must
  be built first), while Jest runs CommonJS and cannot load the ESM `dist`.
- **Decision:**
  - `packages/shared/package.json` declares `main`/`types`/`exports` pointing at
    `./dist/index.js` + `./dist/index.d.ts`. Turbo's `^build` dependency ensures
    shared is built before api typecheck/build.
  - `apps/api` Jest config uses `moduleNameMapper` to resolve `@probooks/shared`
    (and `^(\.{1,2}/.*)\.js$` ESM-style relative imports) to TypeScript source,
    so tests run without a prior build.
- **Consequences:** `pnpm build` (or `turbo`'s graph) must run before a bare
  `tsc` typecheck of api; the standard `pnpm typecheck`/`pnpm test` scripts
  already sequence this. New shared exports are picked up after a shared rebuild.
- **Alternatives considered:** make api ESM (rejected — Nest 10 + ts-jest CJS is
  the established baseline, ADR-0003); publish shared (rejected — monorepo, no
  publish step); ts-jest path aliases only (insufficient for the `.js` ESM specifiers).
