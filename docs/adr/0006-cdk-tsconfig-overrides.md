# ADR-0006: CDK toolchain tsconfig overrides for `@probooks/infra`

- **Status:** Accepted (2026-06-09)
- **Context:** Phase 0 Wave 7 adds the `infra/` package — an AWS CDK v2
  (TypeScript) app, synth-validated only (no live AWS; `docs/phase-0-plan.md`
  J.2). The locked base config `packages/config/tsconfig.base.json`
  (STANDARDS §3) sets, among other strict flags:

  - `module: NodeNext` + `moduleResolution: NodeNext` + `verbatimModuleSyntax`
  - `exactOptionalPropertyTypes: true`

  Two frictions surface against the CDK toolchain:

  1. **Module system.** The `cdk` CLI executes the app entry through `ts-node`
     (`cdk.json` → `ts-node bin/probooks-infra.ts`). `ts-node` + `NodeNext` +
     a `"type": "module"` package is brittle (ESM/CJS resolution of `.ts`
     entrypoints). The NestJS app already took the same exit in
     [ADR-0003](0003-nestjs-tsconfig-overrides.md), overriding to CommonJS for
     its framework toolchain.

  2. **`exactOptionalPropertyTypes`.** `aws-cdk-lib`'s own `.d.ts` files are not
     authored against `exactOptionalPropertyTypes: true`. Concrete constructs
     (e.g. `ec2.Vpc`) declare optional members as `prop?: string | undefined`
     while the interfaces they satisfy (e.g. `ec2.IVpc`) declare `prop: string`,
     so passing a `Vpc` where an `IVpc` is expected fails to type-check under
     this flag (`TS2375`). This is a library type-definition issue, not a defect
     in our code, and cannot be fixed without `any`/casts that STANDARDS §3
     forbids.

- **Decision:**

  - `infra/tsconfig.json` extends the locked base and overrides **only** what
    the CDK toolchain requires:
    - `module: CommonJS`, `moduleResolution: Node`, `esModuleInterop: true`,
      `verbatimModuleSyntax: false` — so `ts-node` runs the app and `tsc`/Vitest
      agree on resolution (mirrors ADR-0003).
    - `exactOptionalPropertyTypes: false` — to consume `aws-cdk-lib`'s types.
  - The package is **not** `"type": "module"` (CommonJS), consistent with the
    above and with `apps/api`.
  - **Every other strict flag from the base is retained**: `strict`,
    `noUncheckedIndexedAccess`, `noImplicitOverride`,
    `noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`,
    `isolatedModules`, `forceConsistentCasingInFileNames`. The shared ESLint
    flat config applies unchanged (`no-explicit-any`, `no-non-null-assertion`,
    import ordering, complexity cap, etc.).
  - Scope is limited to `infra/`. No other package changes. The override is a
    toolchain-compatibility concession for synth-only IaC, not a relaxation of
    application code standards.

- **Consequences:**

  - `cdk synth` and the Vitest assertion suite both run on the CDK type
    definitions without `any` escape hatches.
  - `infra/` loses `exactOptionalPropertyTypes` enforcement locally. The blast
    radius is one synth-only package with no runtime data path and no tenant
    data; the residency/security properties it models are asserted by tests
    (region pin, CMK encryption, public-access block, no cross-region
    replication) rather than by this one type flag.
  - If `aws-cdk-lib` ships `exactOptionalPropertyTypes`-clean types in a future
    major, revisit and drop the override to re-converge with the base.

- **Alternatives considered:**
  - _Keep `exactOptionalPropertyTypes` and cast at call sites._ Rejected:
    requires `any`/`as` casts that violate STANDARDS §3 and spread library
    noise through our code.
  - _Keep `NodeNext`/ESM and use the ts-node ESM loader._ Rejected as brittle
    for a CDK app entry; ADR-0003 already set the CommonJS precedent for a
    framework toolchain in this repo.
  - _Author the stacks in plain JS._ Rejected: STANDARDS §1.3 locks IaC to CDK
    **in TypeScript**.
