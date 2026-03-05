import { logger } from "./logger.js";

export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000,
  label: string = "operation"
): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      logger.warn("Retry", `${label} failed (attempt ${i + 1}/${maxRetries}): ${lastError.message}`);
      if (i < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, delayMs * Math.pow(2, i)));
      }
    }
  }
  throw lastError;
}
