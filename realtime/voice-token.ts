const VOICE_TOKEN_VALIDITY_MS = 60 * 60 * 1000;

export interface IssueVoiceTokenInput {
  participantId: string;
  roomSlug: string;
  subject?: string;
  secret: string;
  now?: number;
}

export interface VerifyVoiceTokenInput {
  token: string;
  participantId: string;
  roomSlug: string;
  secret: string;
  expectedSubject?: string;
  now?: number;
}

export type VerifyVoiceTokenResult =
  | { ok: true; subject: string; timestamp: number }
  | {
      ok: false;
      reason: "format" | "identity" | "subject" | "expired" | "signature";
    };

export async function issueVoiceToken({
  participantId,
  roomSlug,
  subject,
  secret,
  now = Date.now(),
}: IssueVoiceTokenInput): Promise<string> {
  const payload = `${participantId}:${roomSlug}:${now}:${subject || "anonymous"}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  const encodedSignature = btoa(
    String.fromCharCode(...new Uint8Array(signature)),
  );
  return `${payload}.${encodedSignature}`;
}

export async function verifyVoiceToken({
  token,
  participantId,
  roomSlug,
  secret,
  expectedSubject,
  now = Date.now(),
}: VerifyVoiceTokenInput): Promise<VerifyVoiceTokenResult> {
  const dotIndex = token.lastIndexOf(".");
  if (dotIndex === -1) return { ok: false, reason: "format" };

  const payload = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);
  const parts = payload.split(":");
  if (parts.length < 3 || parts[0] !== participantId || parts[1] !== roomSlug) {
    return { ok: false, reason: "identity" };
  }

  const subject = parts.length >= 4 ? parts[3] : "";
  if (expectedSubject !== undefined && subject !== expectedSubject) {
    return { ok: false, reason: "subject" };
  }

  const timestamp = Number.parseInt(parts[2], 10);
  if (Number.isNaN(timestamp) || now - timestamp > VOICE_TOKEN_VALIDITY_MS) {
    return { ok: false, reason: "expired" };
  }

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signatureBytes = Uint8Array.from(atob(signature), (character) =>
      character.charCodeAt(0),
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signatureBytes,
      new TextEncoder().encode(payload),
    );
    if (!valid) return { ok: false, reason: "signature" };
  } catch {
    return { ok: false, reason: "signature" };
  }

  return {
    ok: true,
    subject,
    timestamp,
  };
}
