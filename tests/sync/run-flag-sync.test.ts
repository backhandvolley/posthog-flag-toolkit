import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PostHogFlag } from "../../src/posthog/types.js";
import type { FlagDefinition } from "../../src/registry/types.js";
import { runFlagSync } from "../../src/sync/run-flag-sync.js";

vi.mock("../../src/posthog/api.js", () => ({
  fetchAllFlags: vi.fn(),
  createFlag: vi.fn(),
  patchFlag: vi.fn(),
  hasTag: (flag: PostHogFlag, tag: string) => (flag.tags ?? []).includes(tag),
}));

import { createFlag, fetchAllFlags, patchFlag } from "../../src/posthog/api.js";

const config = { apiKey: "phx_test", projectId: "12345" };
const namingRegex = /^(release|experiment|ops|tier)_(studio|ai)_[a-z0-9_]+$/;

function makeFlag(overrides: Partial<PostHogFlag>): PostHogFlag {
  return {
    id: 1,
    key: "release_studio_test",
    name: "Test flag",
    active: false,
    deleted: false,
    tags: [],
    filters: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runFlagSync", () => {
  it("creates flags that exist in registry but not PostHog", async () => {
    vi.mocked(fetchAllFlags).mockResolvedValue([]);
    vi.mocked(createFlag).mockResolvedValue(null);

    const registry: Record<string, FlagDefinition> = {
      MY_FLAG: {
        key: "release_studio_my_flag",
        description: "My test flag",
        owner: "@test",
        tags: ["studio"],
      },
    };

    const result = await runFlagSync({
      posthog: config,
      registry,
      namingRegex,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(result.created).toBe(1);
    expect(createFlag).toHaveBeenCalledTimes(1);
  });

  it("reconciles description changes", async () => {
    vi.mocked(fetchAllFlags).mockResolvedValue([
      makeFlag({
        id: 42,
        key: "release_studio_my_flag",
        name: "Old description",
        tags: ["studio"],
      }),
    ]);

    const registry: Record<string, FlagDefinition> = {
      MY_FLAG: {
        key: "release_studio_my_flag",
        description: "New description",
        owner: "@test",
        tags: ["studio"],
      },
    };

    const result = await runFlagSync({
      posthog: config,
      registry,
      namingRegex,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(result.reconciled).toBe(1);
    expect(patchFlag).toHaveBeenCalledWith(
      config,
      42,
      expect.objectContaining({ name: "New description" }),
      expect.anything(),
    );
  });

  it("adds tags additively without removing existing ones", async () => {
    vi.mocked(fetchAllFlags).mockResolvedValue([
      makeFlag({
        id: 42,
        key: "release_studio_my_flag",
        name: "My test flag",
        tags: ["studio", "existing-tag"],
      }),
    ]);

    const registry: Record<string, FlagDefinition> = {
      MY_FLAG: {
        key: "release_studio_my_flag",
        description: "My test flag",
        owner: "@test",
        tags: ["studio", "new-tag"],
      },
    };

    const result = await runFlagSync({
      posthog: config,
      registry,
      namingRegex,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(result.reconciled).toBe(1);
    expect(patchFlag).toHaveBeenCalledWith(
      config,
      42,
      expect.objectContaining({
        tags: expect.arrayContaining(["studio", "existing-tag", "new-tag"]),
      }),
      expect.anything(),
    );
  });

  it("is idempotent — no-op when registry matches PostHog", async () => {
    vi.mocked(fetchAllFlags).mockResolvedValue([
      makeFlag({
        key: "release_studio_my_flag",
        name: "My test flag",
        tags: ["studio"],
      }),
    ]);

    const registry: Record<string, FlagDefinition> = {
      MY_FLAG: {
        key: "release_studio_my_flag",
        description: "My test flag",
        owner: "@test",
        tags: ["studio"],
      },
    };

    const result = await runFlagSync({
      posthog: config,
      registry,
      namingRegex,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(result.created).toBe(0);
    expect(result.reconciled).toBe(0);
    expect(createFlag).not.toHaveBeenCalled();
    expect(patchFlag).not.toHaveBeenCalled();
  });

  it("detects orphan flags not in registry", async () => {
    vi.mocked(fetchAllFlags).mockResolvedValue([makeFlag({ key: "release_studio_orphan" })]);

    const onOrphan = vi.fn();
    const result = await runFlagSync({
      posthog: config,
      registry: {},
      namingRegex,
      callbacks: { onOrphan },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(result.orphans).toBe(1);
    expect(onOrphan).toHaveBeenCalledTimes(1);
  });

  it("detects naming violations", async () => {
    vi.mocked(fetchAllFlags).mockResolvedValue([makeFlag({ key: "bad-flag-name" })]);

    const onNamingViolation = vi.fn();
    const result = await runFlagSync({
      posthog: config,
      registry: {},
      namingRegex,
      callbacks: { onNamingViolation },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(result.naming_violations).toBe(1);
    expect(onNamingViolation).toHaveBeenCalledTimes(1);
  });

  it("skips write operations in dryRun mode", async () => {
    vi.mocked(fetchAllFlags).mockResolvedValue([]);
    vi.mocked(createFlag).mockResolvedValue(null);

    const registry: Record<string, FlagDefinition> = {
      MY_FLAG: {
        key: "release_studio_my_flag",
        description: "My test flag",
        owner: "@test",
      },
    };

    await runFlagSync({
      posthog: config,
      registry,
      namingRegex,
      dryRun: true,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(createFlag).toHaveBeenCalledWith(config, expect.anything(), { dryRun: true });
  });

  it("never deletes flags from PostHog", async () => {
    vi.mocked(fetchAllFlags).mockResolvedValue([
      makeFlag({ key: "release_studio_old_flag" }),
      makeFlag({ key: "release_studio_another_old", id: 2 }),
    ]);

    const result = await runFlagSync({
      posthog: config,
      registry: {},
      namingRegex,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(result.orphans).toBe(2);
    // patchFlag should NOT be called to delete — only for reconciliation
    expect(patchFlag).not.toHaveBeenCalled();
  });
});
