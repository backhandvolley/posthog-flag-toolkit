/**
 * Inngest adapter — wraps `run*` functions into `inngest.createFunction` calls,
 * passing `step` through as the StepRunner.
 */

// biome-ignore lint/suspicious/noExplicitAny: Inngest client type varies by consumer's event map
type InngestClient = any;

export interface InngestCronConfig<TResult> {
  id: string;
  name: string;
  cron: string;
  retries?: number;
  run: (step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> }) => Promise<TResult>;
}

/**
 * Wrap a pure `run*` function as an Inngest cron function.
 *
 * ```ts
 * const fn = withInngestCron(inngest, {
 *   id: "flag-sync",
 *   name: "Sync flags",
 *   cron: "* /10 * * * *",
 *   run: (step) => runFlagSync({ posthog: config, registry, namingRegex, step }),
 * });
 * ```
 */
export function withInngestCron<TResult>(
  inngest: InngestClient,
  config: InngestCronConfig<TResult>,
) {
  return inngest.createFunction(
    {
      id: config.id,
      name: config.name,
      retries: config.retries ?? 1,
    },
    { cron: config.cron },
    async ({ step }: { step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> } }) => {
      return config.run(step);
    },
  );
}
