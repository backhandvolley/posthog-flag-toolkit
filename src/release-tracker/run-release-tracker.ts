/**
 * Detects feature flags / experiments hitting 100% rollout and treats that
 * as a "feature release." Pure function with StepRunner + callbacks.
 *
 * Idempotency, timestamps, and stale-flag dedupe all live in PostHog tags
 * (no DB tables): `released-detected-v1` marks first detection,
 * `stale-notified-YYYY-MM` is month-scoped so flags re-nag once per month.
 */

import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import {
  fetchAllExperiments,
  fetchAllFlags,
  findTagAddedAt,
  hasTag,
  isFullyReleased,
  patchFlagTags,
  withTagAdded,
} from "../posthog/api.js";
import type { PostHogClientConfig, PostHogExperiment, PostHogFlag } from "../posthog/types.js";
import { getLifecycle } from "../registry/naming.js";
import type { FlagDefinition } from "../registry/types.js";
import type { StepRunner } from "../step-runner.js";
import { SimpleStepRunner } from "../step-runner.js";

const RELEASED_TAG = "released-detected-v1";
const STALE_THRESHOLD_DAYS = 30;

function staleTagForNow(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `stale-notified-${yyyy}-${mm}`;
}

export interface NewRelease {
  key: string;
  name: string;
  type: "flag" | "experiment";
}

export interface StaleFlagInfo {
  key: string;
  name: string;
  daysSinceRelease: number;
}

export interface OrphanFlag {
  key: string;
}

export interface NamingViolation {
  key: string;
}

export interface DigestPayload {
  newFlagReleases: NewRelease[];
  newExperimentReleases: NewRelease[];
  staleFlags: StaleFlagInfo[];
  orphans: OrphanFlag[];
  namingViolations: NamingViolation[];
}

export interface ReleaseTrackerCallbacks {
  onNewRelease?: (flag: PostHogFlag, type: "flag" | "experiment") => void | Promise<void>;
  onStale?: (flag: PostHogFlag, daysSinceRelease: number) => void | Promise<void>;
  onOrphan?: (flag: PostHogFlag) => void | Promise<void>;
  onNamingViolation?: (flag: PostHogFlag) => void | Promise<void>;
  onDigestReady?: (digest: DigestPayload) => void | Promise<void>;
}

export interface ReleaseTrackerResult {
  flags_checked: number;
  experiments_checked: number;
  new_flag_releases: number;
  new_experiment_releases: number;
  stale_flags_notified: number;
  orphans: number;
  naming_violations: number;
}

export interface ReleaseTrackerOptions {
  posthog: PostHogClientConfig;
  registry: Record<string, FlagDefinition>;
  namingRegex: RegExp;
  namingExemptTag?: string;
  staleThresholdDays?: number;
  step?: StepRunner;
  dryRun?: boolean;
  callbacks?: ReleaseTrackerCallbacks;
  logger?: Logger;
}

export async function runReleaseTracker(
  options: ReleaseTrackerOptions,
): Promise<ReleaseTrackerResult> {
  const {
    posthog,
    registry,
    namingRegex,
    namingExemptTag = "naming-exempt",
    staleThresholdDays = STALE_THRESHOLD_DAYS,
    step = new SimpleStepRunner(),
    dryRun = false,
    callbacks = {},
    logger = consoleLogger,
  } = options;

  logger.info("Feature release tracker started");

  const flags: PostHogFlag[] = await step.run("fetch-flags", () => fetchAllFlags(posthog));

  const registryKeys = new Set<string>(Object.values(registry).map((d) => d.key));
  const orphans = flags
    .filter((f) => !f.deleted && !registryKeys.has(f.key))
    .map((f) => ({ key: f.key }));
  const namingViolations = flags
    .filter((f) => !f.deleted && !hasTag(f, namingExemptTag) && !namingRegex.test(f.key))
    .map((f) => ({ key: f.key }));

  for (const o of orphans) {
    const posthogFlag = flags.find((f) => f.key === o.key);
    if (posthogFlag) await callbacks.onOrphan?.(posthogFlag);
  }
  for (const v of namingViolations) {
    const posthogFlag = flags.find((f) => f.key === v.key);
    if (posthogFlag) await callbacks.onNamingViolation?.(posthogFlag);
  }

  const newlyReleased = flags.filter((f) => isFullyReleased(f) && !hasTag(f, RELEASED_TAG));

  const newFlagReleases: NewRelease[] = [];
  for (const flag of newlyReleased) {
    await step.run(`tag-released-${flag.id}`, async () => {
      await patchFlagTags(posthog, flag.id, withTagAdded(flag, RELEASED_TAG), {
        dryRun,
      });
    });
    await callbacks.onNewRelease?.(flag, "flag");
    newFlagReleases.push({
      key: flag.key,
      name: flag.name ?? flag.key,
      type: "flag",
    });
  }

  const experiments: PostHogExperiment[] = await step.run("fetch-experiments", () =>
    fetchAllExperiments(posthog),
  );

  const newExperimentReleases: NewRelease[] = [];
  const flagsByKey = new Map(flags.map((f) => [f.key, f]));
  const now = Date.now();
  const completedExperiments = experiments.filter((e) => {
    if (e.archived) return false;
    if (!e.end_date) return false;
    return new Date(e.end_date).getTime() <= now;
  });

  for (const exp of completedExperiments) {
    const linkedFlag = flagsByKey.get(exp.feature_flag_key);
    if (!linkedFlag) continue;
    if (hasTag(linkedFlag, RELEASED_TAG)) continue;
    await step.run(`tag-experiment-released-${exp.id}`, async () => {
      await patchFlagTags(posthog, linkedFlag.id, withTagAdded(linkedFlag, RELEASED_TAG), {
        dryRun,
      });
    });
    await callbacks.onNewRelease?.(linkedFlag, "experiment");
    newExperimentReleases.push({
      key: exp.feature_flag_key,
      name: exp.name,
      type: "experiment",
    });
  }

  // Stale detection: only `release_*` and `experiment_*` flags
  const STALE_ELIGIBLE_LIFECYCLES = new Set(["release", "experiment"]);
  const staleTag = staleTagForNow();
  const staleCandidates = flags.filter(
    (f) =>
      hasTag(f, RELEASED_TAG) &&
      !hasTag(f, staleTag) &&
      STALE_ELIGIBLE_LIFECYCLES.has(getLifecycle(f.key)),
  );

  const staleFlags: StaleFlagInfo[] = [];
  for (const flag of staleCandidates) {
    const releasedAt: string | null = await step.run(`find-release-time-${flag.id}`, async () => {
      const t = await findTagAddedAt(posthog, flag.id, RELEASED_TAG);
      return t ? t.toISOString() : null;
    });
    if (!releasedAt) continue;
    const days = Math.floor((now - new Date(releasedAt).getTime()) / (24 * 60 * 60 * 1000));
    if (days < staleThresholdDays) continue;

    await step.run(`tag-stale-${flag.id}`, async () => {
      await patchFlagTags(posthog, flag.id, withTagAdded(flag, staleTag), {
        dryRun,
      });
    });
    await callbacks.onStale?.(flag, days);
    staleFlags.push({
      key: flag.key,
      name: flag.name ?? flag.key,
      daysSinceRelease: days,
    });
  }

  const anyNews =
    newFlagReleases.length +
      newExperimentReleases.length +
      staleFlags.length +
      orphans.length +
      namingViolations.length >
    0;
  if (anyNews) {
    await callbacks.onDigestReady?.({
      newFlagReleases,
      newExperimentReleases,
      staleFlags,
      orphans,
      namingViolations,
    });
  }

  const result: ReleaseTrackerResult = {
    flags_checked: flags.length,
    experiments_checked: experiments.length,
    new_flag_releases: newFlagReleases.length,
    new_experiment_releases: newExperimentReleases.length,
    stale_flags_notified: staleFlags.length,
    orphans: orphans.length,
    naming_violations: namingViolations.length,
  };
  logger.info("Feature release tracker completed", result as unknown as Record<string, unknown>);
  return result;
}
