import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Re-exports the single shared flat config (STANDARDS §4 — one config, no per-app overrides).
export { default } from "@probooks/config/eslint";
