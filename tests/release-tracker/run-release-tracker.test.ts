import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PostHogFlag } from "../../src/posthog/types.js";
import { runReleaseTracker } from "../../src/release-tracker/run-release-tracker.js";

vi.mock("../../src/posthog/api.js", () => ({
  fetchAllFlags: vi.fn(),
  fetchAllExperiments: vi.fn(),
  patchFlagTags: vi.fn(),
  findTagAddedAt: vi.fn(),
  isFullyReleased: vi.fn(),
  hasTag: (flag: PostHogFlag, tag: string) => (flag.tags ?? []).includes(tag),
  withTagAdded: (flag: PostHogFlag, tag: string) => {
    const existing = flag.tags ?? [];
    if (existing.includes(tag)) return existing;
    return [...existing, tag];
  },
}));

import {
  fetchAllExperiments,
  fetchAllFlags,
  findTagAddedAt,
  isFullyReleased,
  patchFlagTags,
} from "../../src/posthog/api.js";

const config = { apiKey: "phx_test", projectId: "12345" };
const namingRegex = /^(release|experiment|ops|tier)_(studio|ai)_[a-z0-9_]+$/;
const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function makeFlag(overrides: Partial<PostHogFlag>): PostHogFlag {
  return {
    id: 1,
    key: "release_studio_test",
    name: "Test flag",
    active: true,
    deleted: false,
    tags: [],
    filters: { groups: [{ rollout_percentage: 100 }] },
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runReleaseTracker", () => {
  it("detects newly released flags (100% rollout, no released tag)", async () => {
    const flag = makeFlag({ id: 10, key: "release_studio_feature" });
    vi.mocked(fetchAllFlags).mockResolvedValue([flag]);
    vi.mocked(fetchAllExperiments).mockResolvedValue([]);
    vi.mocked(isFullyReleased).mockReturnValue(true);

    const onNewRelease = vi.fn();
    const result = await runReleaseTracker({
      posthog: config,
      registry: {
        F: {
          key: "release_studio_feature",
          description: "test",
          owner: "@test",
        },
      },
      namingRegex,
      callbacks: { onNewRelease },
      logger: noopLogger,
    });

    expect(result.new_flag_releases).toBe(1);
    expect(onNewRelease).toHaveBeenCalledWith(flag, "flag");
    expect(patchFlagTags).toHaveBeenCalledTimes(1);
  });

  it("skips flags already tagged as released", async () => {
    const flag = makeFlag({
      key: "release_studio_feature",
      tags: ["released-detected-v1"],
    });
    vi.mocked(fetchAllFlags).mockResolvedValue([flag]);
    vi.mocked(fetchAllExperiments).mockResolvedValue([]);
    vi.mocked(isFullyReleased).mockReturnValue(true);

    const result = await runReleaseTracker({
      posthog: config,
      registry: {
        F: {
          key: "release_studio_feature",
          description: "test",
          owner: "@test",
        },
      },
      namingRegex,
      logger: noopLogger,
    });

    expect(result.new_flag_releases).toBe(0);
  });

  it("detects stale flags released > N days ago", async () => {
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const flag = makeFlag({
      id: 10,
      key: "release_studio_feature",
      tags: ["released-detected-v1"],
    });
    vi.mocked(fetchAllFlags).mockResolvedValue([flag]);
    vi.mocked(fetchAllExperiments).mockResolvedValue([]);
    vi.mocked(isFullyReleased).mockReturnValue(true);
    vi.mocked(findTagAddedAt).mockResolvedValue(thirtyOneDaysAgo);

    const onStale = vi.fn();
    const result = await runReleaseTracker({
      posthog: config,
      registry: {
        F: {
          key: "release_studio_feature",
          description: "test",
          owner: "@test",
        },
      },
      namingRegex,
      staleThresholdDays: 30,
      callbacks: { onStale },
      logger: noopLogger,
    });

    expect(result.stale_flags_notified).toBe(1);
    expect(onStale).toHaveBeenCalledWith(flag, expect.any(Number));
  });

  it("does not flag ops_ or tier_ flags as stale", async () => {
    const flag = makeFlag({
      key: "ops_studio_always_on",
      tags: ["released-detected-v1"],
    });
    vi.mocked(fetchAllFlags).mockResolvedValue([flag]);
    vi.mocked(fetchAllExperiments).mockResolvedValue([]);
    vi.mocked(isFullyReleased).mockReturnValue(false);

    const result = await runReleaseTracker({
      posthog: config,
      registry: {
        F: {
          key: "ops_studio_always_on",
          description: "test",
          owner: "@test",
        },
      },
      namingRegex,
      logger: noopLogger,
    });

    expect(result.stale_flags_notified).toBe(0);
    expect(findTagAddedAt).not.toHaveBeenCalled();
  });

  it("fires onDigestReady when there is news", async () => {
    vi.mocked(fetchAllFlags).mockResolvedValue([makeFlag({ key: "orphaned_flag" })]);
    vi.mocked(fetchAllExperiments).mockResolvedValue([]);
    vi.mocked(isFullyReleased).mockReturnValue(false);

    const onDigestReady = vi.fn();
    await runReleaseTracker({
      posthog: config,
      registry: {},
      namingRegex,
      callbacks: { onDigestReady },
      logger: noopLogger,
    });

    expect(onDigestReady).toHaveBeenCalledTimes(1);
    expect(onDigestReady).toHaveBeenCalledWith(
      expect.objectContaining({
        orphans: expect.arrayContaining([{ key: "orphaned_flag" }]),
      }),
    );
  });
});
