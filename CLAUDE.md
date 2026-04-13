# CLAUDE.md

Guidance for AI assistants working on this repository.

## What This Is

`posthog-flag-toolkit` is a framework-agnostic npm package for managing PostHog feature flags programmatically: type-safe registry, one-way sync, release tracking, and auto-rollback guardian. Zero runtime dependencies — talks to the PostHog REST API directly via `fetch`.

## Project Structure

```
src/
  posthog/          PostHog REST API types + helpers (fetch, create, patch, HogQL)
  registry/         createRegistry factory, naming regex, getLifecycle/getArea
  sync/             runFlagSync — one-way registry → PostHog sync
  release-tracker/  runReleaseTracker — detect 100% rollout, stale flags, experiments
  guardian/         runFlagGuardian — treatment/control regression detection
    decision.ts     Pure: detectRegression, meetsSampleFloor
    thresholds.ts   Default constants, overridable via options
  adapters/
    inngest.ts      withInngestCron helper (optional peer dep)
    slack.ts        Block Kit formatter for Guardian alerts
  step-runner.ts    StepRunner interface + SimpleStepRunner
  logger.ts         Logger interface + console default
  index.ts          Public barrel export
tests/              Mirrors src/ structure
```

## Key Design Decisions

### StepRunner Abstraction

All `run*` functions accept `step: StepRunner` — an interface with one method: `run<T>(id, fn) => Promise<any>`. Inngest's `step` object satisfies this natively. For non-Inngest consumers, `SimpleStepRunner` calls `fn()` directly. **Never import Inngest directly in core logic** — only in `src/adapters/inngest.ts`.

### Callbacks Over Dependencies

Functions accept callback options (`onCreate`, `onRegression`, `onDigestReady`, etc.) instead of importing notification libraries. The consumer decides how to track events, send emails, or post Slack messages. **Never add PostHog tracking, email, or Slack as a dependency** — those belong in the consumer's callbacks.

### Never Delete Flags

Sync and tracker detect orphans via callbacks but never auto-delete from PostHog. That's always a human decision.

### Tag Reconciliation Is Additive

Tags are unioned, never subtracted. PostHog owns the full tag set; we only add.

### PostHog API: Retry on 429

All fetch helpers retry on HTTP 429 with exponential backoff (respecting `Retry-After`), max 3 retries. HogQL queries validate flag keys against `/^[a-z0-9_-]+$/` before interpolation to prevent injection.

## Commands

```bash
npm run validate      # Full pipeline: typecheck + lint + test + build + check-exports
npm run test          # Vitest (60 tests)
npm run test:coverage # With V8 coverage
npm run lint          # Biome check (lint + format)
npm run lint:fix      # Biome auto-fix
npm run build         # tsup → dist/ (CJS + ESM + .d.ts)
npm run check-exports # attw + publint (package export validation)
```

## Changesets Workflow

This repo uses [changesets](https://github.com/changesets/changesets) for versioning.

- **Before opening a PR:** run `npx changeset`, pick patch/minor/major, write a description
- **No release needed:** run `npx changeset --empty` (docs, CI, refactors)
- **CI blocks PRs** without a changeset file
- **On merge to `main`:** changesets action opens a "Version Packages" PR
- **Merging that PR:** publishes to npm + creates a GitHub Release

## Tooling

- **Biome** for linting + formatting (not ESLint) — config in `biome.json`
- **Vitest** for tests — config in `vitest.config.ts`
- **tsup** for building — config in `tsup.config.ts`
- **Lefthook** for git hooks — config in `lefthook.yml`
  - `pre-commit`: Biome check + auto-fix staged files
  - `pre-push`: typecheck

## Package Exports

Three entry points:
- `posthog-flag-toolkit` — core (everything except adapters)
- `posthog-flag-toolkit/adapters/inngest` — Inngest adapter (optional peer dep)
- `posthog-flag-toolkit/adapters/slack` — Slack Block Kit adapter

Dual CJS/ESM with separate `.d.ts` / `.d.cts` type declarations. Validated by `attw` + `publint` in CI.
