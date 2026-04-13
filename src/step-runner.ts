/**
 * Abstraction that decouples orchestration functions from Inngest.
 * Inngest's `step.run()` returns `Promise<Jsonify<T>>` which isn't assignable
 * to `Promise<T>` — so we use `unknown` as the return type to stay compatible.
 */
export interface StepRunner {
  // biome-ignore lint/suspicious/noExplicitAny: Inngest step.run() returns Jsonify<T>, not T
  run<T>(id: string, fn: () => Promise<T>): Promise<any>;
}

/**
 * Simple implementation that just calls `fn()` directly — no durability,
 * suitable for BullMQ, Vercel cron, plain Node, or testing.
 */
export class SimpleStepRunner implements StepRunner {
  async run<T>(_id: string, fn: () => Promise<T>): Promise<T> {
    return fn();
  }
}
