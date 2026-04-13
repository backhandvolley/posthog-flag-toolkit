/**
 * One-way sync from a local registry to PostHog. Pure function with
 * StepRunner + callbacks — no framework dependency.
 *
 * Safety principles:
 *   - Never deletes flags from PostHog (orphans = human review only)
 *   - Never touches active / rollout / conditions (PostHog owns state)
 *   - Tag reconciliation is additive only (union, never subtract)
 *   - New flags created in safe state (active: false, 0% rollout)
 *   - Idempotent — second run is a no-op if registry == PostHog
 */

import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { createFlag, fetchAllFlags, hasTag, patchFlag } from "../posthog/api.js";
import type { PostHogClientConfig, PostHogFlag, PostHogFlagFilters } from "../posthog/types.js";
import type { FlagDefinition } from "../registry/types.js";
import type { StepRunner } from "../step-runner.js";
import { SimpleStepRunner } from "../step-runner.js";

/** Returns the merged array if the union grew, or null for an idempotent skip. */
function unionTags(
  current: readonly string[] | null | undefined,
  wanted: readonly string[],
): string[] | null {
  const currentSet = new Set(current ?? []);
  const merged = new Set(currentSet);
  for (const t of wanted) merged.add(t);
  if (merged.size === currentSet.size) return null;
  return [...merged];
}

function initialTagsFor(def: FlagDefinition): string[] {
  const tags = new Set<string>(def.tags ?? []);
  if (def.guardian) tags.add("guardian");
  return [...tags];
}

export interface FlagSyncCallbacks {
  onCreate?: (def: FlagDefinition) => void | Promise<void>;
  onOrphan?: (flag: PostHogFlag) => void | Promise<void>;
  onNamingViolation?: (flag: PostHogFlag) => void | Promise<void>;
  onReconcile?: (flag: PostHogFlag, patch: Record<string, unknown>) => void | Promise<void>;
}

export interface FlagSyncResult {
  registry_size: number;
  posthog_size: number;
  created: number;
  reconciled: number;
  orphans: number;
  naming_violations: number;
}

export interface FlagSyncOptions {
  posthog: PostHogClientConfig;
  registry: Record<string, FlagDefinition>;
  namingRegex: RegExp;
  namingExemptTag?: string;
  step?: StepRunner;
  dryRun?: boolean;
  callbacks?: FlagSyncCallbacks;
  logger?: Logger;
}

export async function runFlagSync(options: FlagSyncOptions): Promise<FlagSyncResult> {
  const {
    posthog,
    registry,
    namingRegex,
    namingExemptTag = "naming-exempt",
    step = new SimpleStepRunner(),
    dryRun = false,
    callbacks = {},
    logger = consoleLogger,
  } = options;

  logger.info("Feature flag sync started");

  const posthogFlags: PostHogFlag[] = await step.run("fetch-posthog-flags", () =>
    fetchAllFlags(posthog),
  );
  const posthogByKey = new Map(posthogFlags.map((f) => [f.key, f]));

  const registryEntries: FlagDefinition[] = Object.values(registry);
  const registryKeys = new Set<string>(registryEntries.map((d) => d.key));

  const toCreate = registryEntries.filter((d) => !posthogByKey.has(d.key));
  const toReconcile = registryEntries
    .filter((d) => posthogByKey.has(d.key))
    .flatMap((d) => {
      const existing = posthogByKey.get(d.key);
      if (!existing) return [];
      return [{ def: d, existing }];
    });
  const orphans = posthogFlags.filter((f) => !f.deleted && !registryKeys.has(f.key));
  const namingViolations = posthogFlags.filter(
    (f) => !f.deleted && !hasTag(f, namingExemptTag) && !namingRegex.test(f.key),
  );

  const created: string[] = [];
  for (const def of toCreate) {
    await step.run(`create-${def.key}`, async () => {
      const filters: PostHogFlagFilters = {
        groups: [{ properties: [], rollout_percentage: 0 }],
      };
      await createFlag(
        posthog,
        {
          key: def.key,
          name: def.description,
          tags: initialTagsFor(def),
          active: false,
          filters,
        },
        { dryRun },
      );
    });
    created.push(def.key);
    await callbacks.onCreate?.(def);
  }

  const reconciled: string[] = [];
  for (const { def, existing } of toReconcile) {
    const patch: Record<string, unknown> = {};

    if (existing.name !== def.description) {
      patch.name = def.description;
    }

    const wanted: string[] = [...(def.tags ?? [])];
    if (def.guardian) wanted.push("guardian");
    const newTags = unionTags(existing.tags, wanted);
    if (newTags) patch.tags = newTags;

    if (Object.keys(patch).length === 0) continue;

    await step.run(`reconcile-${def.key}`, async () => {
      await patchFlag(posthog, existing.id, patch as Parameters<typeof patchFlag>[2], { dryRun });
    });
    reconciled.push(def.key);
    await callbacks.onReconcile?.(existing, patch);
  }

  for (const orphan of orphans) {
    await callbacks.onOrphan?.(orphan);
  }
  for (const violator of namingViolations) {
    await callbacks.onNamingViolation?.(violator);
  }

  const result: FlagSyncResult = {
    registry_size: registryEntries.length,
    posthog_size: posthogFlags.length,
    created: created.length,
    reconciled: reconciled.length,
    orphans: orphans.length,
    naming_violations: namingViolations.length,
  };
  logger.info("Feature flag sync completed", result as unknown as Record<string, unknown>);
  return result;
}
