/**
 * A small in-memory limiter (fixed window per key) for the REST API. One application server per copy
 * (deployment guide), so memory is enough; with several Node processes each keeps its own count, which
 * only makes the limit looser, never blocks a real user.
 *
 * Limits are generous on purpose: the whole office reaches the server from one address through the
 * Board's network, so a per-address limit must let 200 people sign in at 9 a.m. The real guards on
 * sign-in stay per login (5 wrong passwords lock it, 5 OTPs in 10 minutes, 5 tries per OTP).
 */
export interface Limit {
  /** Requests allowed in one window. */
  max: number;
  windowMs: number;
}

export const LIMITS = {
  /** Sign-in and other pages open without a session, per address. */
  publicWrite: { max: 600, windowMs: 10 * 60 * 1000 },
  /** Any signed-in request, per session (about 5 a second for a whole minute). */
  session: { max: 300, windowMs: 60 * 1000 },
} satisfies Record<string, Limit>;

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
const MAX_KEYS = 50_000;

function prune(now: number) {
  for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
}

/** Counts one request for `key`. Returns how long to wait when the limit is reached. */
export function hit(key: string, limit: Limit, now = Date.now()): { ok: true } | { ok: false; retryAfterS: number } {
  let w = windows.get(key);
  if (!w || w.resetAt <= now) {
    if (windows.size >= MAX_KEYS) prune(now);
    w = { count: 0, resetAt: now + limit.windowMs };
    windows.set(key, w);
  }
  w.count += 1;
  if (w.count > limit.max) return { ok: false, retryAfterS: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
  return { ok: true };
}

/** Tests only. */
export function resetLimits() {
  windows.clear();
}
