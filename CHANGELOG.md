# posthog-flag-toolkit

## 0.1.2

### Patch Changes

- [`5adb0a8`](https://github.com/backhandvolley/posthog-flag-toolkit/commit/5adb0a87d7aea7875da3a195b9a1f1e0cdc8b65f) Thanks [@gurfinkel](https://github.com/gurfinkel)! - Handle "Unable to resolve field" HogQL error for newly created flags with no event data — return empty metrics instead of throwing so guardian treats them as insufficient_data

## 0.1.1

### Patch Changes

- [`fda0b54`](https://github.com/backhandvolley/posthog-flag-toolkit/commit/fda0b54f8693809375fb6b01c6e123908d362574) Thanks [@gurfinkel](https://github.com/gurfinkel)! - Fix HogQL property path escaping — use bracket notation for `$feature/` properties to prevent `/` being parsed as division operator
