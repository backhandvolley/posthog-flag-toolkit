/**
 * Auto-rollback cron logic. Scans flags tagged `guardian` and compares
 * treatment vs control cohorts. Pure function with StepRunner + callbacks.
 */

import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { fetchFlagsByTag, hasTag, patchFlag } from "../posthog/api.js";
import type { EvaluationMetrics } from "../posthog/hogql.js";
import { queryCohortMetrics } from "../posthog/hogql.js";
import type { PostHogClientConfig, PostHogFlag } from "../posthog/types.js";
import type { StepRunner } from "../step-runner.js";
import { SimpleStepRunner } from "../step-runner.js";
import { type DecisionKind, detectRegression, meetsSampleFloor } from "./decision.js";
import type { GuardianThresholds } from "./thresholds.js";
import { mergeThresholds } from "./thresholds.js";

const GUARDIAN_TAG = "guardian";
const GUARDIAN_ENFORCE_TAG = "guardian-enforce";

function isInCooldown(flag: PostHogFlag, cooldownMinutes: number): boolean {
  if (!flag.updated_at) return false;
  const updated = new Date(flag.updated_at).getTime();
  return Date.now() - updated < cooldownMinutes * 60 * 1000;
}

export interface GuardianEvaluation {
  flag: PostHogFlag;
  metrics: EvaluationMetrics;
  decision: DecisionKind;
  reason: string;
  enforced: boolean;
}

export interface GuardianCallbacks {
  onRegression?: (result: GuardianEvaluation) => void | Promise<void>;
  onEvaluated?: (result: GuardianEvaluation) => void | Promise<void>;
  onEnforced?: (flag: PostHogFlag, result: GuardianEvaluation) => void | Promise<void>;
}

export interface FlagOutcome {
  flag_key: string;
  decision: DecisionKind;
  reason: string;
}

export interface GuardianResult {
  flags_evaluated: number;
  regressions_detected: number;
  auto_disabled: number;
  outcomes: FlagOutcome[];
}

export interface GuardianOptions {
  posthog: PostHogClientConfig;
  thresholds?: Partial<GuardianThresholds>;
  /** Custom HogQL config for publish event detection */
  publishEventName?: string;
  publishSuccessProp?: string;
  step?: StepRunner;
  dryRun?: boolean;
  callbacks?: GuardianCallbacks;
  logger?: Logger;
}

export function posthogFlagUrl(
  projectId: string,
  flagId: number,
  baseUrl = "https://us.posthog.com",
): string {
  return `${baseUrl}/project/${projectId}/feature_flags/${flagId}`;
}

export async function runFlagGuardian(options: GuardianOptions): Promise<GuardianResult> {
  const {
    posthog,
    step = new SimpleStepRunner(),
    dryRun = false,
    callbacks = {},
    logger = consoleLogger,
  } = options;
  const thresholds = mergeThresholds(options.thresholds);

  logger.info("Flag guardian started");

  const monitoredFlags: PostHogFlag[] = await step.run("fetch-guardian-flags", async () => {
    const all = await fetchFlagsByTag(posthog, GUARDIAN_TAG);
    return all.filter((f) => f.active && !f.deleted && hasTag(f, GUARDIAN_TAG));
  });

  const windowEnd = new Date();
  const windowStart = new Date(windowEnd.getTime() - thresholds.windowMinutes * 60 * 1000);

  const regressions: GuardianEvaluation[] = [];
  const perFlagOutcomes: FlagOutcome[] = [];

  for (const flag of monitoredFlags) {
    const enforceEnabled = hasTag(flag, GUARDIAN_ENFORCE_TAG);

    if (isInCooldown(flag, thresholds.cooldownMinutes)) {
      perFlagOutcomes.push({
        flag_key: flag.key,
        decision: "insufficient_data",
        reason: "cooldown",
      });
      continue;
    }

    const metrics: EvaluationMetrics = await step.run(`evaluate-${flag.id}`, async () => {
      return queryCohortMetrics({
        config: posthog,
        flagKey: flag.key,
        windowStart,
        windowEnd,
        publishEventName: options.publishEventName,
        publishSuccessProp: options.publishSuccessProp,
      });
    });

    if (!meetsSampleFloor(metrics, thresholds)) {
      perFlagOutcomes.push({
        flag_key: flag.key,
        decision: "insufficient_data",
        reason: "sample_size",
      });
      continue;
    }

    const decision = detectRegression(metrics, thresholds);

    if (decision.kind === "no_regression") {
      const evaluation: GuardianEvaluation = {
        flag,
        metrics,
        decision: "no_regression",
        reason: decision.reason,
        enforced: false,
      };
      await callbacks.onEvaluated?.(evaluation);
      perFlagOutcomes.push({
        flag_key: flag.key,
        decision: "no_regression",
        reason: decision.reason,
      });
      continue;
    }

    // Regression detected — enforce if tagged, otherwise dry-run.
    let enforced = false;
    if (enforceEnabled && !dryRun) {
      await step.run(`enforce-${flag.id}`, async () => {
        await patchFlag(posthog, flag.id, { active: false }, { dryRun });
      });
      enforced = true;
    }

    const finalDecision: DecisionKind = enforced ? "auto_disabled" : "regression_detected";

    const evaluation: GuardianEvaluation = {
      flag,
      metrics,
      decision: finalDecision,
      reason: decision.reason,
      enforced,
    };

    await callbacks.onEvaluated?.(evaluation);
    if (decision.kind === "regression_detected") {
      await callbacks.onRegression?.(evaluation);
    }
    if (enforced) {
      await callbacks.onEnforced?.(flag, evaluation);
    }

    regressions.push(evaluation);
    perFlagOutcomes.push({
      flag_key: flag.key,
      decision: finalDecision,
      reason: decision.reason,
    });
  }

  const result: GuardianResult = {
    flags_evaluated: monitoredFlags.length,
    regressions_detected: regressions.length,
    auto_disabled: regressions.filter((r) => r.enforced).length,
    outcomes: perFlagOutcomes,
  };
  logger.info("Flag guardian completed", {
    flags_evaluated: result.flags_evaluated,
    regressions_detected: result.regressions_detected,
    auto_disabled: result.auto_disabled,
  });
  return result;
}
