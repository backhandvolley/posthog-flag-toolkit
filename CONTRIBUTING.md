# Contributing

## Development Setup

```bash
git clone https://github.com/backhandvolley/posthog-flag-toolkit.git
cd posthog-flag-toolkit
npm install
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Watch mode (rebuilds on file change) |
| `npm run build` | Production build (CJS + ESM + .d.ts) |
| `npm run test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run typecheck` | TypeScript type checking |
| `npm run lint` | Lint + format check (Biome) |
| `npm run lint:fix` | Auto-fix lint + format issues |
| `npm run check-exports` | Validate package exports (publint + attw) |
| `npm run validate` | Full validation (typecheck + lint + test + build + check-exports) |

## Making Changes

1. Create a branch from `main`
2. Make your changes
3. Run `npm run validate` to ensure everything passes
4. Run `npx changeset` to describe your change and pick a semver bump:
   - **patch** — bug fixes, dependency updates
   - **minor** — new features, new exports
   - **major** — breaking API changes
5. Commit the generated `.changeset/*.md` file with your code
6. Open a PR

If your PR doesn't need a release (docs, CI config, refactors), run `npx changeset --empty` instead.

## Project Structure

```
src/
  posthog/
    types.ts          PostHog API types
    api.ts            Fetch/create/patch helpers with 429 retry
    hogql.ts          HogQL cohort metric query
  registry/
    types.ts          FlagDefinition, Lifecycle
    define.ts         createRegistry factory
    naming.ts         Regex builder, getLifecycle, getArea
  sync/
    run-flag-sync.ts  Registry-to-PostHog one-way sync
  release-tracker/
    run-release-tracker.ts  Release detection + stale flag alerting
  guardian/
    decision.ts       detectRegression, meetsSampleFloor (pure)
    thresholds.ts     Default constants, overridable
    run-flag-guardian.ts  Orchestrator with StepRunner + callbacks
  adapters/
    inngest.ts        withInngestCron helper
    slack.ts          Block Kit formatter for Guardian alerts
  step-runner.ts      StepRunner interface + SimpleStepRunner
  logger.ts           Logger interface + console default
  index.ts            Public barrel export
tests/
  (mirrors src/ structure)
```

## Design Principles

- **Pure functions over framework coupling.** All `run*` functions accept a `StepRunner` interface, not an Inngest-specific type. Framework adapters live in `src/adapters/`.
- **Callbacks over dependencies.** Functions accept callback options (`onCreate`, `onRegression`, etc.) instead of importing notification libraries. The consumer decides how to alert.
- **Never delete flags.** Sync and tracker detect orphans but never auto-delete from PostHog. That's always a human decision.
- **Tag reconciliation is additive.** Tags are unioned, never subtracted. PostHog owns the full tag set.

## Release Process

Releases are automated via [changesets](https://github.com/changesets/changesets):

1. Merge PRs with changesets to `main`
2. The release workflow opens a "Version Packages" PR
3. Review the changelog and version bump
4. Merge the Version Packages PR to publish to npm
