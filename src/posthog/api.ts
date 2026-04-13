import type {
  ActivityList,
  PostHogClientConfig,
  PostHogExperiment,
  PostHogExperimentList,
  PostHogFlag,
  PostHogFlagFilters,
  PostHogFlagList,
} from "./types.js";

const DEFAULT_BASE_URL = "https://us.posthog.com";
const MAX_RETRIES = 3;

function baseUrl(config: PostHogClientConfig): string {
  return config.baseUrl ?? DEFAULT_BASE_URL;
}

function headers(config: PostHogClientConfig): Record<string, string> {
  return { Authorization: `Bearer ${config.apiKey}` };
}

function jsonHeaders(config: PostHogClientConfig): Record<string, string> {
  return {
    ...headers(config),
    "Content-Type": "application/json",
  };
}

/**
 * Retry with exponential backoff on 429. PostHog returns `Retry-After` header;
 * we respect it, capped at MAX_RETRIES.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = MAX_RETRIES,
): Promise<Response> {
  let attempt = 0;
  while (true) {
    const res = await fetch(url, init);
    if (res.status !== 429 || attempt >= retries) return res;
    attempt++;
    const retryAfter = res.headers.get("Retry-After");
    const waitMs = retryAfter
      ? Math.min(Number(retryAfter) * 1000, 30_000)
      : Math.min(1000 * 2 ** attempt, 30_000);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

// Read helpers

/** Fetch every flag in the project, paginating through PostHog's cursor pagination. */
export async function fetchAllFlags(config: PostHogClientConfig): Promise<PostHogFlag[]> {
  const flags: PostHogFlag[] = [];
  let url: string | null =
    `${baseUrl(config)}/api/projects/${config.projectId}/feature_flags/?limit=200`;
  while (url) {
    const res = await fetchWithRetry(url, { headers: headers(config) });
    if (!res.ok) {
      throw new Error(
        `PostHog flag fetch failed: ${res.status} ${await res.text().catch(() => "")}`,
      );
    }
    const data = (await res.json()) as PostHogFlagList;
    flags.push(...data.results);
    url = data.next;
  }
  return flags;
}

/**
 * Note: PostHog's `?tags=` filter is substring-based — callers should re-filter
 * for exact tag matches via `hasTag()` to be safe.
 */
export async function fetchFlagsByTag(
  config: PostHogClientConfig,
  tag: string,
): Promise<PostHogFlag[]> {
  const res = await fetchWithRetry(
    `${baseUrl(config)}/api/projects/${config.projectId}/feature_flags/?tags=${encodeURIComponent(tag)}&limit=200`,
    { headers: headers(config) },
  );
  if (!res.ok) {
    throw new Error(
      `PostHog flag fetch by tag failed: ${res.status} ${await res.text().catch(() => "")}`,
    );
  }
  const data = (await res.json()) as PostHogFlagList;
  return data.results;
}

export async function fetchAllExperiments(
  config: PostHogClientConfig,
): Promise<PostHogExperiment[]> {
  const res = await fetchWithRetry(
    `${baseUrl(config)}/api/projects/${config.projectId}/experiments/?limit=200`,
    { headers: headers(config) },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as PostHogExperimentList;
  return data.results;
}

/**
 * Find when a specific tag was added to a flag by scanning PostHog's activity log.
 */
export async function findTagAddedAt(
  config: PostHogClientConfig,
  flagId: number,
  tag: string,
): Promise<Date | null> {
  const res = await fetchWithRetry(
    `${baseUrl(config)}/api/projects/${config.projectId}/feature_flags/${flagId}/activity/?limit=100`,
    { headers: headers(config) },
  );
  if (!res.ok) return null;
  const data = (await res.json()) as ActivityList;
  for (const entry of data.results) {
    const changes = entry.detail?.changes ?? [];
    for (const change of changes) {
      if (change.field !== "tags") continue;
      const before = Array.isArray(change.before) ? (change.before as string[]) : [];
      const after = Array.isArray(change.after) ? (change.after as string[]) : [];
      if (!before.includes(tag) && after.includes(tag)) {
        return new Date(entry.created_at);
      }
    }
  }
  return null;
}

// Write helpers

export interface FlagPatch {
  name?: string;
  tags?: string[];
  active?: boolean;
  filters?: PostHogFlagFilters;
}

/** Pass only the fields you want to change. */
export async function patchFlag(
  config: PostHogClientConfig,
  flagId: number,
  patch: FlagPatch,
  options?: { dryRun?: boolean },
): Promise<void> {
  if (options?.dryRun) return;
  const res = await fetchWithRetry(
    `${baseUrl(config)}/api/projects/${config.projectId}/feature_flags/${flagId}/`,
    {
      method: "PATCH",
      headers: jsonHeaders(config),
      body: JSON.stringify(patch),
    },
  );
  if (!res.ok) {
    throw new Error(`PostHog flag PATCH failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
}

export async function patchFlagTags(
  config: PostHogClientConfig,
  flagId: number,
  tags: string[],
  options?: { dryRun?: boolean },
): Promise<void> {
  return patchFlag(config, flagId, { tags }, options);
}

export interface CreateFlagBody {
  key: string;
  /** Goes into PostHog's `name` field (which is actually the description). */
  name: string;
  tags: string[];
  active?: boolean;
  filters?: PostHogFlagFilters;
}

/**
 * Defaults to `active: false, rollout: 0%` if filters is omitted.
 */
export async function createFlag(
  config: PostHogClientConfig,
  body: CreateFlagBody,
  options?: { dryRun?: boolean },
): Promise<PostHogFlag | null> {
  if (options?.dryRun) return null;
  const payload = {
    key: body.key,
    name: body.name,
    tags: body.tags,
    active: body.active ?? false,
    filters: body.filters ?? {
      groups: [{ properties: [], rollout_percentage: 0 }],
    },
    creation_context: "feature_flags",
  };
  const res = await fetchWithRetry(
    `${baseUrl(config)}/api/projects/${config.projectId}/feature_flags/`,
    {
      method: "POST",
      headers: jsonHeaders(config),
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    throw new Error(
      `PostHog flag CREATE failed: ${res.status} ${await res.text().catch(() => "")}`,
    );
  }
  return (await res.json()) as PostHogFlag;
}

// Pure utilities

/**
 * Active, not deleted, and every release condition at 100% rollout. Flags with
 * zero groups are considered NOT released.
 */
export function isFullyReleased(flag: PostHogFlag): boolean {
  if (!flag.active || flag.deleted) return false;
  const groups = flag.filters?.groups ?? [];
  if (groups.length === 0) return false;
  return groups.every((g) => (g.rollout_percentage ?? 100) === 100);
}

export function hasTag(flag: PostHogFlag, tag: string): boolean {
  return (flag.tags ?? []).includes(tag);
}

export function withTagAdded(flag: PostHogFlag, tag: string): string[] {
  const existing = flag.tags ?? [];
  if (existing.includes(tag)) return existing;
  return [...existing, tag];
}
