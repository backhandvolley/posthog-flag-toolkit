import { describe, expect, it } from "vitest";
import { createRegistry } from "../../src/registry/define.js";
import { buildNamingRegex, getArea, getLifecycle } from "../../src/registry/naming.js";

describe("buildNamingRegex", () => {
  const regex = buildNamingRegex(["studio", "ai", "publish"]);

  it("matches valid keys", () => {
    expect(regex.test("release_studio_my_feature")).toBe(true);
    expect(regex.test("experiment_ai_ab_test")).toBe(true);
    expect(regex.test("ops_publish_maintenance")).toBe(true);
    expect(regex.test("tier_studio_pro_feature")).toBe(true);
  });

  it("rejects invalid lifecycle", () => {
    expect(regex.test("beta_studio_feature")).toBe(false);
    expect(regex.test("test_studio_feature")).toBe(false);
  });

  it("rejects invalid area", () => {
    expect(regex.test("release_billing_feature")).toBe(false);
    expect(regex.test("release_dashboard_feature")).toBe(false);
  });

  it("rejects uppercase", () => {
    expect(regex.test("release_studio_MyFeature")).toBe(false);
    expect(regex.test("Release_studio_feature")).toBe(false);
  });

  it("rejects empty feature name", () => {
    expect(regex.test("release_studio_")).toBe(false);
  });

  it("allows numbers in feature name", () => {
    expect(regex.test("release_studio_v2_rollout")).toBe(true);
    expect(regex.test("release_ai_model_3")).toBe(true);
  });
});

describe("getLifecycle", () => {
  it("extracts lifecycle prefix", () => {
    expect(getLifecycle("release_studio_feature")).toBe("release");
    expect(getLifecycle("experiment_ai_test")).toBe("experiment");
    expect(getLifecycle("ops_publish_maintenance")).toBe("ops");
    expect(getLifecycle("tier_studio_pro")).toBe("tier");
  });
});

describe("getArea", () => {
  it("extracts area segment", () => {
    expect(getArea("release_studio_feature")).toBe("studio");
    expect(getArea("experiment_ai_test")).toBe("ai");
    expect(getArea("ops_publish_maintenance")).toBe("publish");
  });
});

describe("createRegistry", () => {
  it("creates a registry with custom areas", () => {
    const { NAMING_REGEX, getLifecycle, getArea } = createRegistry({
      areas: ["billing", "auth", "dashboard"] as const,
    });

    expect(NAMING_REGEX.test("release_billing_feature")).toBe(true);
    expect(NAMING_REGEX.test("release_auth_sso")).toBe(true);
    expect(NAMING_REGEX.test("release_studio_feature")).toBe(false);

    expect(getLifecycle("release_billing_feature")).toBe("release");
    expect(getArea("release_billing_feature")).toBe("billing");
  });

  it("flag() accessor returns the key from registry", () => {
    const { flag } = createRegistry({ areas: ["studio"] as const });
    const reg = {
      MY_FLAG: { key: "release_studio_my_flag", description: "test", owner: "@test" },
    };
    expect(flag("MY_FLAG", reg)).toBe("release_studio_my_flag");
  });
});
