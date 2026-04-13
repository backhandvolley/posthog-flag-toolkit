import type { EvaluationMetrics } from "../posthog/hogql.js";
import type { GuardianThresholds } from "./thresholds.js";

export type DecisionKind =
  | "insufficient_data"
  | "no_regression"
  | "regression_detected"
  | "auto_disabled";

export interface Decision {
  kind: DecisionKind;
  reason: string;
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${(n * 100).toFixed(2)}%`;
}

export function detectRegression(
  metrics: EvaluationMetrics,
  thresholds: GuardianThresholds,
): Decision {
  const { treatment, control } = metrics;

  // Error rate regression: treatment >= Nx control AND both nonzero
  if (
    treatment.errorRate != null &&
    control.errorRate != null &&
    control.errorRate > 0 &&
    treatment.errorRate / control.errorRate >= thresholds.errorRateRatioThreshold
  ) {
    const ratio = treatment.errorRate / control.errorRate;
    return {
      kind: "regression_detected",
      reason: `error rate ratio ${ratio.toFixed(2)}x (${fmtPct(treatment.errorRate)} vs ${fmtPct(control.errorRate)})`,
    };
  }

  // Edge case: control error rate is 0 but treatment is non-trivial
  if (
    treatment.errorRate != null &&
    treatment.errorRate > 0.01 &&
    (control.errorRate == null || control.errorRate === 0)
  ) {
    return {
      kind: "regression_detected",
      reason: `treatment error rate ${fmtPct(treatment.errorRate)} vs control 0%`,
    };
  }

  // Publish success drop
  if (
    treatment.publishSuccessRate != null &&
    control.publishSuccessRate != null &&
    control.publishSuccessRate - treatment.publishSuccessRate >=
      thresholds.publishSuccessDropThreshold
  ) {
    const drop = control.publishSuccessRate - treatment.publishSuccessRate;
    return {
      kind: "regression_detected",
      reason: `publish success drop ${(drop * 100).toFixed(1)}pp (${fmtPct(treatment.publishSuccessRate)} vs ${fmtPct(control.publishSuccessRate)})`,
    };
  }

  return { kind: "no_regression", reason: "all metrics within thresholds" };
}

export function meetsSampleFloor(
  metrics: EvaluationMetrics,
  thresholds: GuardianThresholds,
): boolean {
  return (
    metrics.treatment.eventCount >= thresholds.minSampleSize &&
    metrics.treatment.uniqueUsers >= thresholds.minUniqueUsers &&
    metrics.control.eventCount >= thresholds.minSampleSize &&
    metrics.control.uniqueUsers >= thresholds.minUniqueUsers
  );
}
