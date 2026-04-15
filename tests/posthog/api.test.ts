import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasTag, isFullyReleased, withTagAdded } from "../../src/posthog/api.js";
import type { PostHogFlag } from "../../src/posthog/types.js";

function makeFlag(overrides?: Partial<PostHogFlag>): PostHogFlag {
  return {
    id: 1,
    key: "test_flag",
    name: "Test",
    active: true,
    deleted: false,
    tags: [],
    filters: { groups: [{ rollout_percentage: 100 }] },
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("isFullyReleased", () => {
  it("returns true for active flag at 100% rollout", () => {
    expect(isFullyReleased(makeFlag())).toBe(true);
  });

  it("returns false for inactive flag", () => {
    expect(isFullyReleased(makeFlag({ active: false }))).toBe(false);
  });

  it("returns false for deleted flag", () => {
    expect(isFullyReleased(makeFlag({ deleted: true }))).toBe(false);
  });

  it("returns false for flag with 0% rollout", () => {
    expect(
      isFullyReleased(
        makeFlag({
          filters: { groups: [{ rollout_percentage: 0 }] },
        }),
      ),
    ).toBe(false);
  });

  it("returns false for flag with no groups", () => {
    expect(isFullyReleased(makeFlag({ filters: { groups: [] } }))).toBe(false);
  });

  it("returns true when rollout is null (PostHog default = 100%)", () => {
    expect(
      isFullyReleased(
        makeFlag({
          filters: { groups: [{ rollout_percentage: null }] },
        }),
      ),
    ).toBe(true);
  });

  it("returns true when all groups are at 100%", () => {
    expect(
      isFullyReleased(
        makeFlag({
          filters: {
            groups: [{ rollout_percentage: 100 }, { rollout_percentage: 100 }],
          },
        }),
      ),
    ).toBe(true);
  });

  it("returns false when any group is not at 100%", () => {
    expect(
      isFullyReleased(
        makeFlag({
          filters: {
            groups: [{ rollout_percentage: 100 }, { rollout_percentage: 50 }],
          },
        }),
      ),
    ).toBe(false);
  });
});

describe("hasTag", () => {
  it("returns true when tag exists", () => {
    expect(hasTag(makeFlag({ tags: ["guardian", "studio"] }), "guardian")).toBe(true);
  });

  it("returns false when tag does not exist", () => {
    expect(hasTag(makeFlag({ tags: ["studio"] }), "guardian")).toBe(false);
  });

  it("handles null tags", () => {
    expect(hasTag(makeFlag({ tags: null }), "guardian")).toBe(false);
  });
});

describe("withTagAdded", () => {
  it("adds a new tag", () => {
    const result = withTagAdded(makeFlag({ tags: ["studio"] }), "guardian");
    expect(result).toEqual(["studio", "guardian"]);
  });

  it("does not duplicate existing tag", () => {
    const result = withTagAdded(makeFlag({ tags: ["studio", "guardian"] }), "guardian");
    expect(result).toEqual(["studio", "guardian"]);
  });

  it("handles null tags", () => {
    const result = withTagAdded(makeFlag({ tags: null }), "guardian");
    expect(result).toEqual(["guardian"]);
  });
});

describe("fetchAllFlags retry on 429", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("retries on 429 and succeeds", async () => {
    const { fetchAllFlags: fetchAllFlagsReal } = await import("../../src/posthog/api.js");

    let callCount = 0;
    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response("Rate limited", {
          status: 429,
          headers: { "Retry-After": "0" },
        });
      }
      return new Response(JSON.stringify({ results: [makeFlag()], next: null }), { status: 200 });
    });

    const flags = await fetchAllFlagsReal({
      apiKey: "phx_test",
      projectId: "12345",
    });
    expect(flags).toHaveLength(1);
    expect(callCount).toBe(2);
  });
});

describe("HogQL flag key sanitization", () => {
  it("rejects flag keys with special characters", async () => {
    const { queryCohortMetrics } = await import("../../src/posthog/hogql.js");

    await expect(
      queryCohortMetrics({
        config: { apiKey: "phx_test", projectId: "12345" },
        flagKey: "my_flag'; DROP TABLE events; --",
        windowStart: new Date(),
        windowEnd: new Date(),
      }),
    ).rejects.toThrow("Invalid flag key for HogQL interpolation");
  });

  it("accepts valid flag keys", async () => {
    const { queryCohortMetrics } = await import("../../src/posthog/hogql.js");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
    );

    try {
      const result = await queryCohortMetrics({
        config: { apiKey: "phx_test", projectId: "12345" },
        flagKey: "release_studio_my-feature_v2",
        windowStart: new Date(),
        windowEnd: new Date(),
      });
      expect(result.treatment.eventCount).toBe(0);

      const body = JSON.parse((globalThis.fetch as any).mock.calls[0][1].body);
      expect(body.query.query).toContain("properties[`$feature/release_studio_my-feature_v2`]");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
