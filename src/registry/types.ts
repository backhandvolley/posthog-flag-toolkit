export type Lifecycle = "release" | "experiment" | "ops" | "tier";

export interface FlagDefinition<K extends string = string> {
  key: K;
  description: string;
  /** @Slack handle or email — shown in admin digests + orphan reports. */
  owner: string;
  /** Navigation tags applied additively to PostHog (e.g. "studio", "instagram"). */
  tags?: readonly string[];
  /** Opt into guardian monitoring on creation (adds the `guardian` tag). */
  guardian?: boolean;
  sunsetTarget?: string;
}
