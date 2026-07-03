const VOICE_TOKEN_ANONYMOUS_USER = "anonymous";
export const VOICE_TOKEN_VALIDITY_MS = 60 * 60 * 1000;

export interface ParsedVoiceToken {
  payload: string;
  signature: string;
  participantId: string;
  roomSlug: string;
  issuedAt: number;
  clerkUserId?: string;
}

function createVoiceTokenKey(secret: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export function parseVoiceToken(token: string): ParsedVoiceToken | null {
  const dotIdx = token.lastIndexOf(".");
  if (dotIdx === -1) return null;

  const payload = token.slice(0, dotIdx);
  const signature = token.slice(dotIdx + 1);
  const parts = payload.split(":");
  if (parts.length < 3) return null;

  const issuedAt = Number.parseInt(parts[2] ?? "", 10);
  if (!Number.isFinite(issuedAt)) return null;

  return {
    payload,
    signature,
    participantId: parts[0] ?? "",
    roomSlug: parts[1] ?? "",
    issuedAt,
    clerkUserId: parts[3] && parts[3] !== VOICE_TOKEN_ANONYMOUS_USER ? parts[3] : undefined,
  };
}

export function isVoiceTokenExpired(
  token: ParsedVoiceToken,
  now = Date.now(),
  validityMs = VOICE_TOKEN_VALIDITY_MS,
): boolean {
  return now - token.issuedAt > validityMs;
}

export async function createVoiceToken(
  secret: string | undefined,
  participantId: string,
  roomSlug: string,
  clerkUserId?: string,
  issuedAt = Date.now(),
): Promise<string> {
  if (!secret) return "";

  const payload = `${participantId}:${roomSlug}:${issuedAt}:${clerkUserId || VOICE_TOKEN_ANONYMOUS_USER}`;
  const key = await createVoiceTokenKey(secret, "sign");
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));
  return `${payload}.${signature}`;
}

export async function verifyVoiceToken(
  secret: string | undefined,
  token: ParsedVoiceToken,
): Promise<boolean> {
  if (!secret) return false;

  try {
    const key = await createVoiceTokenKey(secret, "verify");
    const signatureBytes = Uint8Array.from(atob(token.signature), (char) => char.charCodeAt(0));
    return await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(token.payload),
    );
  } catch {
    return false;
  }
}
