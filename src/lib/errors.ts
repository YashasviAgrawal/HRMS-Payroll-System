import type { TKey } from "./i18n";

/**
 * An error meant for the person using the screen. `key` points at a translated message so the same
 * error reads correctly in Hindi and English; `fields` marks form fields that need attention.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly key: TKey,
    public readonly vars?: Record<string, string | number>,
    public readonly fields?: Record<string, TKey | string>,
  ) {
    super(code);
  }
}

export const badRequest = (key: TKey = "errors.validation", fields?: Record<string, TKey | string>, vars?: Record<string, string | number>) =>
  new AppError(400, "bad_request", key, vars, fields);
export const unauthorized = () => new AppError(401, "unauthorized", "errors.notSignedIn");
export const forbidden = (key: TKey = "errors.forbidden") => new AppError(403, "forbidden", key);
export const notFound = () => new AppError(404, "not_found", "errors.notFound");
export const conflict = (key: TKey, vars?: Record<string, string | number>, fields?: Record<string, TKey | string>) =>
  new AppError(409, "conflict", key, vars, fields);
export const tooMany = (key: TKey = "errors.rateLimited", vars?: Record<string, string | number>) =>
  new AppError(429, "too_many", key, vars);

/** Too many requests from one address or session; the reply carries Retry-After. */
export class RateLimitError extends AppError {
  constructor(public readonly retryAfterS: number) {
    super(429, "rate_limited", "errors.rateLimited");
  }
}
