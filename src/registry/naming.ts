import type { Lifecycle } from "./types.js";

export function buildNamingRegex(areas: readonly string[]): RegExp {
  return new RegExp(`^(release|experiment|ops|tier)_(${areas.join("|")})_[a-z0-9_]+$`);
}

export function getLifecycle(key: string): Lifecycle {
  return key.split("_")[0] as Lifecycle;
}

export function getArea<A extends string>(key: string): A {
  return key.split("_")[1] as A;
}
