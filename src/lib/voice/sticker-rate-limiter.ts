/**
 * Token-bucket rate limiter for voice sticker reactions.
 *
 * Allows short bursts while still enforcing a long-run average:
 *  - Bucket capacity: 5 tokens
 *  - Refill rate: 1 token every 3 seconds
 *
 * Call `consume()` before sending a reaction; it returns false if the
 * bucket is empty (caller should silently drop the event).
 */

const CAPACITY = 5;
const REFILL_INTERVAL_MS = 3_000; // one token per 3 s

let tokens = CAPACITY;
let lastRefillAt = Date.now();

function refill() {
  const now = Date.now();
  const elapsed = now - lastRefillAt;
  const gained = Math.floor(elapsed / REFILL_INTERVAL_MS);
  if (gained > 0) {
    tokens = Math.min(CAPACITY, tokens + gained);
    lastRefillAt += gained * REFILL_INTERVAL_MS;
  }
}

/**
 * Attempt to consume one token.
 * Returns `true` if the send is allowed, `false` if rate-limited.
 */
export function consumeStickerToken(): boolean {
  refill();
  if (tokens <= 0) return false;
  tokens--;
  return true;
}

/** Remaining tokens (for UI feedback, not for security). */
export function remainingStickerTokens(): number {
  refill();
  return tokens;
}
