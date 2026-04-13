import { describe, expect, it } from "vitest";
import { detectRegression, meetsSampleFloor } from "../../src/guardian/decision.js";
import { DEFAULT_THRESHOLDS, mergeThresholds } from "../../src/guardian/thresholds.js";
import type { EvaluationMetrics } from "../../src/posthog/hogql.js";

function makeMetrics(overrides?: {
  treatment?: Partial<EvaluationMetrics["treatment"]>;
  control?: Partial<EvaluationMetrics["control"]>;
}): EvaluationMetrics {
  return {
    treatment: {
      eventCount: 200,
      uniqueUsers: 100,
      errorRate: 0.01,
      publishSuccessRate: 0.95,
      ...overrides?.treatment,
    },
    control: {
      eventCount: 200,
      uniqueUsers: 100,
      errorRate: 0.01,
      publishSuccessRate: 0.95,
      ...overrides?.control,
    },
  };
}

describe("detectRegression", () => {
  const t = DEFAULT_THRESHOLDS;

  it("returns no_regression when metrics are within thresholds", () => {
    const metrics = makeMetrics();
    const result = detectRegression(metrics, t);
    expect(result.kind).toBe("no_regression");
  });

  it("detects error rate regression at 2x threshold", () => {
    const metrics = makeMetrics({
      treatment: { errorRate: 0.1 },
      control: { errorRate: 0.05 },
    });
    const result = detectRegression(metrics, t);
    expect(result.kind).toBe("regression_detected");
    expect(result.reason).toContain("error rate ratio");
  });

  it("detects error rate regression at exactly 2x", () => {
    const metrics = makeMetrics({
      treatment: { errorRate: 0.1 },
      control: { errorRate: 0.05 },
    });
    const result = detectRegression(metrics, t);
    expect(result.kind).toBe("regression_detected");
  });

  it("does not flag when just below 2x", () => {
    const metrics = makeMetrics({
      treatment: { errorRate: 0.099 },
      control: { errorRate: 0.05 },
    });
    const result = detectRegression(metrics, t);
    expect(result.kind).toBe("no_regression");
  });

  it("detects control=0 edge case when treatment error rate > 1%", () => {
    const metrics = makeMetrics({
      treatment: { errorRate: 0.02 },
      control: { errorRate: 0 },
    });
    const result = detectRegression(metrics, t);
    expect(result.kind).toBe("regression_detected");
    expect(result.reason).toContain("vs control 0%");
  });

  it("does not flag control=0 when treatment error rate <= 1%", () => {
    const metrics = makeMetrics({
      treatment: { errorRate: 0.005 },
      control: { errorRate: 0 },
    });
    const result = detectRegression(metrics, t);
    expect(result.kind).toBe("no_regression");
  });

  it("detects publish success drop >= 15pp", () => {
    const metrics = makeMetrics({
      treatment: { publishSuccessRate: 0.8 },
      control: { publishSuccessRate: 0.96 },
    });
    const result = detectRegression(metrics, t);
    expect(result.kind).toBe("regression_detected");
    expect(result.reason).toContain("publish success drop");
  });

  it("does not flag publish success drop < 15pp", () => {
    const metrics = makeMetrics({
      treatment: { publishSuccessRate: 0.86 },
      control: { publishSuccessRate: 0.95 },
    });
    const result = detectRegression(metrics, t);
    expect(result.kind).toBe("no_regression");
  });

  it("handles null rates gracefully", () => {
    const metrics = makeMetrics({
      treatment: { errorRate: null, publishSuccessRate: null },
      control: { errorRate: null, publishSuccessRate: null },
    });
    const result = detectRegression(metrics, t);
    expect(result.kind).toBe("no_regression");
  });

  it("respects custom thresholds", () => {
    const custom = mergeThresholds({ errorRateRatioThreshold: 1.5 });
    const metrics = makeMetrics({
      treatment: { errorRate: 0.08 },
      control: { errorRate: 0.05 },
    });
    const result = detectRegression(metrics, custom);
    expect(result.kind).toBe("regression_detected");
  });
});

describe("meetsSampleFloor", () => {
  const t = DEFAULT_THRESHOLDS;

  it("returns true when both cohorts meet minimums", () => {
    const metrics = makeMetrics();
    expect(meetsSampleFloor(metrics, t)).toBe(true);
  });

  it("returns false when treatment event count is too low", () => {
    const metrics = makeMetrics({
      treatment: { eventCount: 50 },
    });
    expect(meetsSampleFloor(metrics, t)).toBe(false);
  });

  it("returns false when treatment unique users is too low", () => {
    const metrics = makeMetrics({
      treatment: { uniqueUsers: 10 },
    });
    expect(meetsSampleFloor(metrics, t)).toBe(false);
  });

  it("returns false when control event count is too low", () => {
    const metrics = makeMetrics({
      control: { eventCount: 50 },
    });
    expect(meetsSampleFloor(metrics, t)).toBe(false);
  });

  it("returns false when control unique users is too low", () => {
    const metrics = makeMetrics({
      control: { uniqueUsers: 10 },
    });
    expect(meetsSampleFloor(metrics, t)).toBe(false);
  });

  it("respects custom minimums", () => {
    const custom = mergeThresholds({ minSampleSize: 10, minUniqueUsers: 5 });
    const metrics = makeMetrics({
      treatment: { eventCount: 15, uniqueUsers: 8 },
      control: { eventCount: 15, uniqueUsers: 8 },
    });
    expect(meetsSampleFloor(metrics, custom)).toBe(true);
  });
});
