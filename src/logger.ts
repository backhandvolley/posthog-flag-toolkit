export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export const consoleLogger: Logger = {
  info: (msg, data) => console.log(`[posthog-flag-toolkit] ${msg}`, data ?? ""),
  warn: (msg, data) => console.warn(`[posthog-flag-toolkit] ${msg}`, data ?? ""),
  error: (msg, data) => console.error(`[posthog-flag-toolkit] ${msg}`, data ?? ""),
};
