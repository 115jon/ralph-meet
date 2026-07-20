import {
  getSoundboardUploadUrl,
  SOUNDBOARD_UPLOAD_PATH,
} from "./soundboard-media";

const CAPABILITY_VERSION = "sbm1";
const CAPABILITY_DOMAIN = "ralph-meet/soundboard-media";
const textEncoder = new TextEncoder();
const tokenPartPattern = /^[A-Za-z0-9_-]+$/;

export interface SoundboardMediaCapabilityClaims {
  soundId: string;
  sourceServerId: string;
  roomSlug: string;
  playbackId: string;
  issuerSubject: string;
  expiresAt: number;
}

export interface SoundboardMediaCapabilityContext {
  now: number;
  soundId?: string;
  sourceServerId?: string;
  roomSlug?: string;
  playbackId?: string;
}

export type SoundboardMediaCapabilityVerification =
  | { ok: true; claims: SoundboardMediaCapabilityClaims }
  | {
      ok: false;
      reason:
        | "expired"
        | "invalid"
        | "sound_mismatch"
        | "server_mismatch"
        | "room_mismatch"
        | "playback_mismatch";
    };

export async function issueSoundboardMediaCapability(
  claims: SoundboardMediaCapabilityClaims,
  secret: string,
): Promise<string> {
  if (!secret || !isValidClaims(claims)) {
    throw new Error("Cannot issue an invalid soundboard media capability");
  }

  const payload = base64UrlEncode(textEncoder.encode(JSON.stringify(claims)));
  const signedValue = `${CAPABILITY_VERSION}.${payload}`;
  const signature = await sign(signedValue, secret);
  return `${signedValue}.${base64UrlEncode(signature)}`;
}

export async function verifySoundboardMediaCapability(
  token: string,
  secret: string,
  context: SoundboardMediaCapabilityContext,
): Promise<SoundboardMediaCapabilityVerification> {
  if (!secret || typeof token !== "string") {
    return { ok: false, reason: "invalid" };
  }

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== CAPABILITY_VERSION) {
    return { ok: false, reason: "invalid" };
  }

  const [version, encodedPayload, encodedSignature] = parts;
  const payloadBytes = base64UrlDecode(encodedPayload);
  const signatureBytes = base64UrlDecode(encodedSignature);
  if (!payloadBytes || !signatureBytes) {
    return { ok: false, reason: "invalid" };
  }

  const signedValue = `${version}.${encodedPayload}`;
  if (!(await verify(signedValue, signatureBytes, secret))) {
    return { ok: false, reason: "invalid" };
  }

  const claims = parseClaims(payloadBytes);
  if (!claims) return { ok: false, reason: "invalid" };
  if (context.now >= claims.expiresAt) {
    return { ok: false, reason: "expired" };
  }
  if (context.soundId !== undefined && context.soundId !== claims.soundId) {
    return { ok: false, reason: "sound_mismatch" };
  }
  if (
    context.sourceServerId !== undefined &&
    context.sourceServerId !== claims.sourceServerId
  ) {
    return { ok: false, reason: "server_mismatch" };
  }
  if (context.roomSlug !== undefined && context.roomSlug !== claims.roomSlug) {
    return { ok: false, reason: "room_mismatch" };
  }
  if (
    context.playbackId !== undefined &&
    context.playbackId !== claims.playbackId
  ) {
    return { ok: false, reason: "playback_mismatch" };
  }

  return { ok: true, claims };
}

export function getSoundboardMediaCapabilityUrl(
  soundId: string,
  token: string,
  context: Pick<SoundboardMediaCapabilityClaims, "roomSlug" | "playbackId">,
): string {
  const params = new URLSearchParams({
    cap: token,
    room_slug: context.roomSlug,
    playback_id: context.playbackId,
  });
  return `${getSoundboardUploadUrl(soundId)}?${params.toString()}`;
}

export function getSoundboardMediaCapabilityExpiresAtFromUrl(
  value: unknown,
): number | null {
  if (typeof value !== "string") return null;

  try {
    const url = new URL(value, "https://voice-room.invalid");
    if (!url.pathname.startsWith(SOUNDBOARD_UPLOAD_PATH)) return null;
    const token = url.searchParams.get("cap");
    if (!token) return null;
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== CAPABILITY_VERSION) return null;
    const encodedPayload = parts[1];
    if (!encodedPayload) return null;
    const payloadBytes = base64UrlDecode(encodedPayload);
    if (!payloadBytes) return null;
    return parseClaims(payloadBytes)?.expiresAt ?? null;
  } catch {
    return null;
  }
}

function isValidClaims(value: SoundboardMediaCapabilityClaims): boolean {
  return (
    isBoundString(value.soundId) &&
    isBoundString(value.sourceServerId) &&
    isBoundString(value.roomSlug) &&
    isBoundString(value.playbackId) &&
    isBoundString(value.issuerSubject) &&
    Number.isFinite(value.expiresAt) &&
    value.expiresAt > 0
  );
}

function isBoundString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function parseClaims(
  bytes: Uint8Array,
): SoundboardMediaCapabilityClaims | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    const claims: SoundboardMediaCapabilityClaims = {
      soundId: record.soundId as string,
      sourceServerId: record.sourceServerId as string,
      roomSlug: record.roomSlug as string,
      playbackId: record.playbackId as string,
      issuerSubject: record.issuerSubject as string,
      expiresAt: record.expiresAt as number,
    };
    return isValidClaims(claims) ? claims : null;
  } catch {
    return null;
  }
}

async function sign(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(`${CAPABILITY_DOMAIN}\0${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(value),
  );
  return new Uint8Array(signature);
}

async function verify(
  value: string,
  signature: Uint8Array,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(`${CAPABILITY_DOMAIN}\0${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    toArrayBuffer(signature),
    textEncoder.encode(value),
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array | null {
  if (!tokenPartPattern.test(value)) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}
