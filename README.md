# posthog-flag-toolkit

[![CI](https://github.com/backhandvolley/posthog-flag-toolkit/actions/workflows/ci.yml/badge.svg)](https://github.com/backhandvolley/posthog-flag-toolkit/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/posthog-flag-toolkit)](https://www.npmjs.com/package/posthog-flag-toolkit)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Type-safe feature flag registry, one-way sync, release tracking, and auto-rollback guardian for [PostHog](https://posthog.com). Framework-agnostic core with optional adapters for Inngest and Slack.

## Install

```bash
npm install posthog-flag-toolkit
```

## Quick Start

### 1. Define your registry

```typescript
import { createRegistry, type FlagDefinition } from "posthog-flag-toolkit";

const { NAMING_REGEX, getLifecycle, getArea } = createRegistry({
  areas: ["studio", "ai", "billing", "auth"] as const,
});

const registry = {
  RELEASE_STUDIO_NEW_EDITOR: {
    key: "release_studio_new_editor",
    description: "Gates the new Tiptap-based editor in the studio.",
    owner: "@yourname",
    tags: ["studio"],
    guardian: true,
  },
} as const satisfies Record<string, FlagDefinition>;
```

### 2. Sync flags to PostHog

```typescript
import { runFlagSync } from "posthog-flag-toolkit";

const result = await runFlagSync({
  posthog: { apiKey: "phx_...", projectId: "12345" },
  registry,
  namingRegex: NAMING_REGEX,
  callbacks: {
    onCreate: (def) => console.log(`Created ${def.key}`),
    onOrphan: (flag) => console.log(`Orphan: ${flag.key}`),
  },
});
```

### 3. Track releases

```typescript
import { runReleaseTracker } from "posthog-flag-toolkit";

const result = await runReleaseTracker({
  posthog: { apiKey: "phx_...", projectId: "12345" },
  registry,
  namingRegex: NAMING_REGEX,
  callbacks: {
    onNewRelease: (flag, type) => console.log(`Released: ${flag.key} (${type})`),
    onStale: (flag, days) => console.log(`Stale: ${flag.key} (${days} days)`),
    onDigestReady: (digest) => sendEmail(digest),
  },
});
```

### 4. Auto-rollback with Guardian

```typescript
import { runFlagGuardian } from "posthog-flag-toolkit";

const result = await runFlagGuardian({
  posthog: { apiKey: "phx_...", projectId: "12345" },
  thresholds: { errorRateRatioThreshold: 2.0 },
  callbacks: {
    onRegression: (evaluation) => alert(evaluation),
    onEnforced: (flag) => console.log(`Auto-disabled: ${flag.key}`),
  },
});
```

## Inngest Adapter

For durable execution with [Inngest](https://www.inngest.com/), pass `step` as the `StepRunner`:

```typescript
import { runFlagSync } from "posthog-flag-toolkit";

export const syncFn = inngest.createFunction(
  { id: "flag-sync" },
  { cron: "*/10 * * * *" },
  async ({ step }) => {
    return runFlagSync({ posthog: config, registry, namingRegex, step });
  },
);
```

Or use the `withInngestCron` helper:

```typescript
import { withInngestCron } from "posthog-flag-toolkit/adapters/inngest";

export const syncFn = withInngestCron(inngest, {
  id: "flag-sync",
  name: "Sync flags",
  cron: "*/10 * * * *",
  run: (step) => runFlagSync({ posthog: config, registry, namingRegex, step }),
});
```

## Slack Adapter

```typescript
import { postGuardianAlert } from "posthog-flag-toolkit/adapters/slack";

await postGuardianAlert(webhookUrl, {
  severity: "critical",
  flagKey: "release_studio_new_editor",
  flagName: "New Editor",
  decision: "auto_disabled",
  enforced: true,
  reason: "error rate ratio 3.2x",
  metrics: { treatmentErrorRate: 0.15, controlErrorRate: 0.047 },
  posthogFlagUrl: "https://us.posthog.com/project/12345/feature_flags/42",
});
```

## API

### Core Functions

| Function | Description |
|---|---|
| `runFlagSync(options)` | One-way sync from registry to PostHog (create, reconcile, detect orphans) |
| `runReleaseTracker(options)` | Detect 100% rollout releases, stale flags, experiments |
| `runFlagGuardian(options)` | Compare treatment/control cohorts, auto-disable on regression |
| `createRegistry(config)` | Factory for typed flag registry with naming regex |

### PostHog API Helpers

| Function | Description |
|---|---|
| `fetchAllFlags(config)` | Paginated fetch of all flags |
| `fetchFlagsByTag(config, tag)` | Fetch flags by tag (substring filter) |
| `createFlag(config, body)` | Create a new flag |
| `patchFlag(config, flagId, patch)` | Update a flag |
| `isFullyReleased(flag)` | Check if flag is active + 100% rollout |
| `queryCohortMetrics(params)` | HogQL query for treatment/control metrics |

### Guardian Decision Logic

| Function | Description |
|---|---|
| `detectRegression(metrics, thresholds)` | Pure function: compare metrics against thresholds |
| `meetsSampleFloor(metrics, thresholds)` | Check if both cohorts have enough data |
| `mergeThresholds(overrides?)` | Merge custom thresholds with defaults |

All `run*` functions accept an optional `step: StepRunner` parameter. Inngest's `step` object satisfies the interface natively. Without it, a `SimpleStepRunner` is used (direct execution, no durability).

## Configuration

### PostHogClientConfig

```typescript
{ apiKey: string; projectId: string; baseUrl?: string }
```

### GuardianThresholds

| Option | Default | Description |
|---|---|---|
| `windowMinutes` | 20 | HogQL lookback window |
| `minSampleSize` | 100 | Min events per cohort |
| `minUniqueUsers` | 50 | Min distinct users per cohort |
| `errorRateRatioThreshold` | 2.0 | Treatment/control error rate ratio |
| `publishSuccessDropThreshold` | 0.15 | Max acceptable success rate drop (pp) |
| `cooldownMinutes` | 30 | Skip recently-updated flags |

## License

MIT
