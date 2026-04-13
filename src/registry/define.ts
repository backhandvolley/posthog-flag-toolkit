import { buildNamingRegex, getArea, getLifecycle } from "./naming.js";
import type { FlagDefinition, Lifecycle } from "./types.js";

export interface RegistryConfig<A extends string> {
  areas: readonly A[];
  extraTags?: readonly string[];
}

export type FeatureFlagKey<A extends string> = `${Lifecycle}_${A}_${string}`;

export interface Registry<A extends string> {
  /**
   * Define the full registry object. The `satisfies` constraint is applied
   * by the consumer at the call site for compile-time validation.
   */
  NAMING_REGEX: RegExp;

  /** Typed accessor for consumer code. */
  flag<K extends string>(name: K, registry: Record<K, FlagDefinition>): string;

  /** Get the lifecycle prefix from a flag key. */
  getLifecycle: (key: string) => Lifecycle;

  /** Get the area segment from a flag key. */
  getArea: (key: string) => A;
}

/**
 * Factory that produces a registry bound to an app's specific areas.
 *
 * Consumer usage:
 * ```ts
 * const { NAMING_REGEX, flag, getLifecycle, getArea } = createRegistry({
 *   areas: ["studio", "ai", "publish"] as const,
 * });
 * ```
 */
export function createRegistry<A extends string>(config: RegistryConfig<A>): Registry<A> {
  const NAMING_REGEX = buildNamingRegex(config.areas);

  function flag<K extends string>(name: K, registry: Record<K, FlagDefinition>): string {
    return registry[name].key;
  }

  return {
    NAMING_REGEX,
    flag,
    getLifecycle,
    getArea: (key: string) => getArea<A>(key),
  };
}
