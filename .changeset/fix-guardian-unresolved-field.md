---
"posthog-flag-toolkit": patch
---

Handle "Unable to resolve field" HogQL error for newly created flags with no event data — return empty metrics instead of throwing so guardian treats them as insufficient_data
