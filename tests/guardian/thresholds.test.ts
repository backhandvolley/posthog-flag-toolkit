import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, mergeThresholds } from "../../src/guardian/thresholds.js";

describe("DEFAULT_THRESHOLDS", () => {
  it("has expected default values", () => {
    expect(DEFAULT_THRESHOLDS.windowMinutes).toBe(20);
    expect(DEFAULT_THRESHOLDS.minSampleSize).toBe(100);
    expect(DEFAULT_THRESHOLDS.minUniqueUsers).toBe(50);
    expect(DEFAULT_THRESHOLDS.errorRateRatioThreshold).toBe(2.0);
    expect(DEFAULT_THRESHOLDS.publishSuccessDropThreshold).toBe(0.15);
    expect(DEFAULT_THRESHOLDS.cooldownMinutes).toBe(30);
  });
});

describe("mergeThresholds", () => {
  it("returns defaults when no overrides", () => {
    expect(mergeThresholds()).toEqual(DEFAULT_THRESHOLDS);
    expect(mergeThresholds({})).toEqual(DEFAULT_THRESHOLDS);
  });

  it("overrides individual values", () => {
    const result = mergeThresholds({ windowMinutes: 60, minSampleSize: 500 });
    expect(result.windowMinutes).toBe(60);
    expect(result.minSampleSize).toBe(500);
    expect(result.minUniqueUsers).toBe(DEFAULT_THRESHOLDS.minUniqueUsers);
    expect(result.errorRateRatioThreshold).toBe(DEFAULT_THRESHOLDS.errorRateRatioThreshold);
  });

  it("preserves all fields", () => {
    const result = mergeThresholds({ cooldownMinutes: 0 });
    expect(result).toEqual({
      ...DEFAULT_THRESHOLDS,
      cooldownMinutes: 0,
    });
  });
});
