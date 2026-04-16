import { fetchWithRetry } from "./api.js";
import type { PostHogClientConfig } from "./types.js";

const FLAG_KEY_REGEX = /^[a-z0-9_-]+$/;

export interface CohortMetrics {
  eventCount: number;
  uniqueUsers: number;
  errorRate: number | null;
  publishSuccessRate: number | null;
}

export interface EvaluationMetrics {
  treatment: CohortMetrics;
  control: CohortMetrics;
}

/**
 * Normalize variant strings from PostHog. For boolean flags we get
 * "true"/"false"; for multivariate flags we get the variant key.
 * For v1 Guardian only boolean flags are supported.
 */
function normalizeVariant(raw: string | null | undefined): "treatment" | "control" | "unknown" {
  if (raw == null) return "unknown";
  const s = String(raw).toLowerCase();
  if (s === "false" || s === "0") return "control";
  if (s === "true" || s === "1") return "treatment";
  return "unknown";
}

/**
 * Single HogQL round-trip for per-cohort metrics. Partitions by the
 * `$feature/<flag_key>` property the PostHog SDKs attach to every event.
 *
 * Flag key is validated against a strict regex before interpolation.
 */
export async function queryCohortMetrics(params: {
  config: PostHogClientConfig;
  flagKey: string;
  windowStart: Date;
  windowEnd: Date;
  /** Custom publish event name. Defaults to `post/publish.completed`. */
  publishEventName?: string;
  /** Custom publish success property. Defaults to `properties.success`. */
  publishSuccessProp?: string;
}): Promise<EvaluationMetrics> {
  const { config, flagKey, windowStart, windowEnd } = params;
  const publishEvent = params.publishEventName ?? "post/publish.completed";
  const publishProp = params.publishSuccessProp ?? "properties.success";

  if (!FLAG_KEY_REGEX.test(flagKey)) {
    throw new Error(
      `Invalid flag key for HogQL interpolation: "${flagKey}". Must match ${FLAG_KEY_REGEX}`,
    );
  }

  const baseUrl = config.baseUrl ?? "https://us.posthog.com";

  const zero: CohortMetrics = {
    eventCount: 0,
    uniqueUsers: 0,
    errorRate: null,
    publishSuccessRate: null,
  };

  const variantProp = `properties[\`$feature/${flagKey}\`]`;

  const hogql = `
    SELECT
      toString(${variantProp}) AS variant,
      count() AS total_events,
      count(DISTINCT distinct_id) AS unique_users,
      countIf(event = '$exception') AS error_events,
      countIf(event = '${publishEvent}' AND ${publishProp} = true) AS publish_successes,
      countIf(event = '${publishEvent}') AS publish_total
    FROM events
    WHERE timestamp >= toDateTime('${windowStart.toISOString()}')
      AND timestamp < toDateTime('${windowEnd.toISOString()}')
      AND ${variantProp} IS NOT NULL
    GROUP BY variant
  `;

  const res = await fetchWithRetry(`${baseUrl}/api/projects/${config.projectId}/query/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: { kind: "HogQLQuery", query: hogql },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 400 && body.includes("Unable to resolve field")) {
      return {
        treatment: { ...zero },
        control: { ...zero },
      };
    }
    throw new Error(`PostHog HogQL query failed for ${flagKey}: ${res.status} ${body}`);
  }

  const data = (await res.json()) as {
    results: Array<[string, number, number, number, number, number]>;
  };

  const metrics: EvaluationMetrics = {
    treatment: { ...zero },
    control: { ...zero },
  };

  for (const row of data.results ?? []) {
    const [variantRaw, totalEvents, uniqueUsers, errorEvents, publishSuccesses, publishTotal] = row;
    const cohort: CohortMetrics = {
      eventCount: Number(totalEvents ?? 0),
      uniqueUsers: Number(uniqueUsers ?? 0),
      errorRate: totalEvents > 0 ? Number(errorEvents ?? 0) / Number(totalEvents) : null,
      publishSuccessRate:
        publishTotal > 0 ? Number(publishSuccesses ?? 0) / Number(publishTotal) : null,
    };

    const variant = normalizeVariant(variantRaw);
    if (variant === "treatment") metrics.treatment = cohort;
    else if (variant === "control") metrics.control = cohort;
  }

  return metrics;
}
