/**
 * Minimal subset of PostHog's FeatureFlag schema — only the fields we use.
 *
 * IMPORTANT: PostHog's FeatureFlag schema has NO separate `description` field.
 * The `name` field IS the description, kept under that name for backwards
 * compatibility. From the OpenAPI spec:
 *
 *   name: { type: string, description: "contains the description for the flag
 *     (field name `name` is kept for backwards-compatibility)" }
 */

export interface PostHogClientConfig {
  apiKey: string;
  projectId: string;
  baseUrl?: string;
}

export interface PostHogFlagGroup {
  variant?: string | null;
  properties?: unknown[];
  rollout_percentage?: number | null;
}

export interface PostHogFlagFilters {
  groups?: PostHogFlagGroup[];
}

export interface PostHogFlag {
  id: number;
  key: string;
  /** Description of the flag — PostHog calls this `name` for legacy reasons. */
  name: string | null;
  active: boolean;
  deleted: boolean;
  tags: string[] | null;
  filters: PostHogFlagFilters | null;
  created_at: string;
  updated_at?: string;
}

export interface PostHogFlagList {
  results: PostHogFlag[];
  next: string | null;
}

export interface PostHogExperiment {
  id: number;
  name: string;
  feature_flag_key: string;
  start_date: string | null;
  end_date: string | null;
  archived: boolean;
}

export interface PostHogExperimentList {
  results: PostHogExperiment[];
}

export interface ActivityEntry {
  created_at: string;
  activity: string;
  detail: {
    changes?: Array<{ field: string; after: unknown; before: unknown }>;
  } | null;
}

export interface ActivityList {
  results: ActivityEntry[];
}
