/**
 * Webhook signature verification utility.
 *
 * kova-auth signs all outbound webhook payloads with HMAC-SHA256 using the
 * endpoint's secret. The signature is sent in the `X-Kova-Auth-Signature`
 * header as `sha256=<hex>`.
 *
 * Use this helper in your webhook receiver to verify that payloads genuinely
 * came from kova-auth and have not been tampered with.
 *
 * @example
 * ```ts
 * // Next.js App Router route handler
 * import { verifyWebhookSignature } from "@kova/react/webhook";
 *
 * export async function POST(req: Request) {
 *   const rawBody = await req.text();
 *   const signature = req.headers.get("x-kova-auth-signature") ?? "";
 *   const secret = process.env.KOVA_AUTH_WEBHOOK_SECRET!;
 *
 *   if (!verifyWebhookSignature(rawBody, signature, secret)) {
 *     return new Response("Invalid signature", { status: 401 });
 *   }
 *
 *   const event = JSON.parse(rawBody);
 *   // handle event...
 *   return new Response("OK");
 * }
 * ```
 *
 * @example
 * ```ts
 * // Express / Node.js
 * import express from "express";
 * import { verifyWebhookSignature } from "@kova/react";
 *
 * app.post("/webhooks/kova-auth", express.raw({ type: "application/json" }), (req, res) => {
 *   const rawBody = req.body.toString("utf-8");
 *   const signature = req.headers["x-kova-auth-signature"] ?? "";
 *   if (!verifyWebhookSignature(rawBody, signature, process.env.KOVA_AUTH_WEBHOOK_SECRET!)) {
 *     return res.status(401).json({ error: "Invalid signature" });
 *   }
 *   // handle event...
 *   res.json({ received: true });
 * });
 * ```
 */

// ── Signature format ─────────────────────────────────────────────────────────
//
// Header:  X-Kova-Auth-Signature: sha256=<hex>
// Body:    Raw request body bytes (must read before JSON.parse)
//
// Algorithm: HMAC-SHA256
//   key  = the endpoint's raw secret (stored from creation response)
//   data = raw UTF-8 request body bytes
//
// ── Timestamp tolerance ───────────────────────────────────────────────────────
//
// When `maxAgeSeconds` is provided, the header is expected to carry a timestamp:
//   X-Kova-Auth-Signature: t=<unix_ms>,sha256=<hex>
//
// This is the same format as Stripe webhooks. Pass `maxAgeSeconds: 300` (5 min)
// to reject replayed payloads.

export interface VerifyOptions {
  /**
   * Maximum age of the webhook payload in seconds.
   * When set, the `X-Kova-Auth-Signature` header must include a `t=<timestamp>`
   * component and the payload must not be older than this many seconds.
   *
   * @example 300 (5 minutes — recommended for production)
   */
  maxAgeSeconds?: number;
}

export interface WebhookEvent<T = unknown> {
  /** Event type, e.g. `"user.signIn"`, `"apiKey.created"`. */
  event: string;
  /** Unix millisecond timestamp when the event was emitted. */
  timestamp: number;
  /** Event-specific payload. */
  data: T;
}

/**
 * Verifies that an inbound webhook payload's HMAC-SHA256 signature matches
 * what kova-auth would have generated with the given secret.
 *
 * Works in both Node.js (via `crypto`) and Web/Edge environments (via
 * `SubtleCrypto` / `globalThis.crypto`).
 *
 * @param rawBody   - Raw request body as a string (before `JSON.parse`)
 * @param signature - The `X-Kova-Auth-Signature` header value
 * @param secret    - The webhook endpoint's signing secret (from creation response)
 * @param options   - Optional timestamp tolerance configuration
 * @returns `true` when the signature is valid (and not expired if `maxAgeSeconds` set)
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string,
  options: VerifyOptions = {}
): Promise<boolean> {
  try {
    // ── Parse the signature header ──────────────────────────────────────────
    // Supports two formats:
    //   1. `sha256=<hex>`              (no timestamp)
    //   2. `t=<unix_ms>,sha256=<hex>` (with timestamp, Stripe-compatible)
    let timestamp: number | null = null;
    let expectedHex: string | null = null;

    for (const part of signature.split(",")) {
      const trimmed = part.trim();
      if (trimmed.startsWith("t=")) {
        timestamp = parseInt(trimmed.slice(2), 10);
      } else if (trimmed.startsWith("sha256=")) {
        expectedHex = trimmed.slice(7);
      }
    }

    if (!expectedHex) return false;

    // ── Timestamp tolerance ─────────────────────────────────────────────────
    if (options.maxAgeSeconds !== undefined) {
      if (timestamp === null) return false; // timestamp required when checking age
      const ageMs = Date.now() - timestamp;
      if (ageMs > options.maxAgeSeconds * 1000 || ageMs < 0) return false;
    }

    // ── HMAC-SHA256 computation ─────────────────────────────────────────────
    // The signed message includes the timestamp when present (Stripe pattern):
    //   message = `${timestamp}.${rawBody}`   when timestamp header is present
    //   message = rawBody                      otherwise
    const message = timestamp !== null ? `${timestamp}.${rawBody}` : rawBody;

    const actualHex = await computeHmacSha256Hex(secret, message);

    // ── Constant-time comparison ────────────────────────────────────────────
    return constantTimeEqual(actualHex, expectedHex);
  } catch {
    return false;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function computeHmacSha256Hex(
  secret: string,
  message: string
): Promise<string> {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await globalThis.crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time string comparison to prevent timing attacks. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
