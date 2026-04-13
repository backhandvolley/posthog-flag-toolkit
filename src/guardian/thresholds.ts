export interface GuardianThresholds {
  windowMinutes: number;
  minSampleSize: number;
  minUniqueUsers: number;
  errorRateRatioThreshold: number;
  publishSuccessDropThreshold: number;
  cooldownMinutes: number;
}

export const DEFAULT_THRESHOLDS: GuardianThresholds = {
  windowMinutes: 20,
  minSampleSize: 100,
  minUniqueUsers: 50,
  errorRateRatioThreshold: 2.0,
  publishSuccessDropThreshold: 0.15,
  cooldownMinutes: 30,
};

export function mergeThresholds(overrides?: Partial<GuardianThresholds>): GuardianThresholds {
  return { ...DEFAULT_THRESHOLDS, ...overrides };
}
