// PostHog API

export type { Decision, DecisionKind } from "./guardian/decision.js";
export { detectRegression, fmtPct, meetsSampleFloor } from "./guardian/decision.js";
export type {
  FlagOutcome,
  GuardianCallbacks,
  GuardianEvaluation,
  GuardianOptions,
  GuardianResult,
} from "./guardian/run-flag-guardian.js";
// Guardian
export { posthogFlagUrl, runFlagGuardian } from "./guardian/run-flag-guardian.js";
export type { GuardianThresholds } from "./guardian/thresholds.js";
export { DEFAULT_THRESHOLDS, mergeThresholds } from "./guardian/thresholds.js";
// Logger
export type { Logger } from "./logger.js";
export { consoleLogger } from "./logger.js";
export type { CreateFlagBody, FlagPatch } from "./posthog/api.js";
export {
  createFlag,
  fetchAllExperiments,
  fetchAllFlags,
  fetchFlagsByTag,
  findTagAddedAt,
  hasTag,
  isFullyReleased,
  patchFlag,
  patchFlagTags,
  withTagAdded,
} from "./posthog/api.js";
export type { CohortMetrics, EvaluationMetrics } from "./posthog/hogql.js";
export { queryCohortMetrics } from "./posthog/hogql.js";
export type {
  ActivityEntry,
  ActivityList,
  PostHogClientConfig,
  PostHogExperiment,
  PostHogExperimentList,
  PostHogFlag,
  PostHogFlagFilters,
  PostHogFlagGroup,
  PostHogFlagList,
} from "./posthog/types.js";
export type { FeatureFlagKey, Registry, RegistryConfig } from "./registry/define.js";
export { createRegistry } from "./registry/define.js";
export { buildNamingRegex, getArea, getLifecycle } from "./registry/naming.js";
// Registry
export type { FlagDefinition, Lifecycle } from "./registry/types.js";
export type {
  DigestPayload,
  NamingViolation,
  NewRelease,
  OrphanFlag,
  ReleaseTrackerCallbacks,
  ReleaseTrackerOptions,
  ReleaseTrackerResult,
  StaleFlagInfo,
} from "./release-tracker/run-release-tracker.js";
// Release Tracker
export { runReleaseTracker } from "./release-tracker/run-release-tracker.js";
// Step Runner
export type { StepRunner } from "./step-runner.js";
export { SimpleStepRunner } from "./step-runner.js";
export type {
  FlagSyncCallbacks,
  FlagSyncOptions,
  FlagSyncResult,
} from "./sync/run-flag-sync.js";
// Sync
export { runFlagSync } from "./sync/run-flag-sync.js";
