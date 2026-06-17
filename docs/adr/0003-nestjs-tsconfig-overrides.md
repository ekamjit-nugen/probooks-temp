# ADR-0003: NestJS tsconfig overrides in apps/api

- **Status:** Accepted (2026-06-04)
- **Context:** STANDARDS §3 locks a strict `tsconfig.base.json` with
  `module: NodeNext`, `verbatimModuleSyntax: true`, `esModuleInterop: false`.
  NestJS 10 relies on `emitDecoratorMetadata` + `experimentalDecorators` for DI
  and runs on CommonJS. `verbatimModuleSyntax: true` strips type-only imports
  that decorator metadata needs at runtime, breaking dependency injection.
- **Decision:** `apps/api/tsconfig.json` extends the base but overrides, for the
  NestJS app only: `module: CommonJS`, `moduleResolution: Node`,
  `esModuleInterop: true`, `verbatimModuleSyntax: false`,
  `emitDecoratorMetadata: true`, `experimentalDecorators: true`. All other
  strictness flags (`strict`, `noUncheckedIndexedAccess`, etc.) are inherited
  unchanged.
- **Consequences:** The API service keeps full type strictness while satisfying
  Nest's runtime needs. Frontend apps (Phase 1+) keep the base settings.
- **Alternatives considered:** SWC-only build without metadata (rejected — loses
  Nest DI ergonomics); a separate base config (rejected — only the API needs this).
- **Reference:** ADR-0002 (auth provider: Auth0 vs Cognito) is deferred to Phase 1;
  Phase 0 uses an internal JWT issuer behind an interface.
