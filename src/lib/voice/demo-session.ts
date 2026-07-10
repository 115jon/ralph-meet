const DEMO_SESSION_COOKIE = "ralph_demo_session";
const DEMO_SESSION_TTL_SECONDS = 24 * 60 * 60;
const DEMO_SESSION_VERSION = "ds1";
const textEncoder = new TextEncoder();

type DemoSessionPayload = {
  expiresAt: number;
  subject: string;
};

export type DemoSession = {
  cookie: string | null;
  subject: string;
};

export async function getOrCreateDemoSession(
  request: Request,
  secret: string,
  now = Date.now(),
): Promise<DemoSession> {
  const existing = await verifyDemoSession(readCookie(request.headers.get("cookie"), DEMO_SESSION_COOKIE), secret, now);
  if (existing) {
    return { cookie: null, subject: existing.subject };
  }

  const payload: DemoSessionPayload = {
    expiresAt: now + DEMO_SESSION_TTL_SECONDS * 1000,
    subject: `demo-${crypto.randomUUID()}`,
  };
  const value = await encodeDemoSession(payload, secret);
  return {
    cookie: `${DEMO_SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${DEMO_SESSION_TTL_SECONDS}`,
    subject: payload.subject,
  };
}

async function verifyDemoSession(value: string | null, secret: string, now: number): Promise<DemoSessionPayload | null> {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== DEMO_SESSION_VERSION) return null;
  const [version, payload, signature] = parts;
  const payloadBytes = base64UrlDecode(payload);
  const signatureBytes = base64UrlDecode(signature);
  if (!payloadBytes || !signatureBytes) return null;
  if (!(await verify(`${version}.${payload}`, signatureBytes, secret))) return null;

  try {
    const decoded: unknown = JSON.parse(new TextDecoder().decode(payloadBytes));
    if (!isDemoSessionPayload(decoded) || decoded.expiresAt <= now) return null;
    return decoded;
  } catch {
    return null;
  }
}

async function encodeDemoSession(payload: DemoSessionPayload, secret: string): Promise<string> {
  const encodedPayload = base64UrlEncode(textEncoder.encode(JSON.stringify(payload)));
  const signedValue = `${DEMO_SESSION_VERSION}.${encodedPayload}`;
  return `${signedValue}.${base64UrlEncode(await sign(signedValue, secret))}`;
}

function isDemoSessionPayload(value: unknown): value is DemoSessionPayload {
  return typeof value === "object"
    && value !== null
    && typeof (value as Record<string, unknown>).subject === "string"
    && /^demo-[A-Za-z0-9-]{8,}$/.test((value as Record<string, unknown>).subject as string)
    && typeof (value as Record<string, unknown>).expiresAt === "number"
    && Number.isFinite((value as Record<string, unknown>).expiresAt);
}

async function sign(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, textEncoder.encode(value)));
}

async function verify(value: string, signature: Uint8Array, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const copy = new Uint8Array(signature.byteLength);
  copy.set(signature);
  return crypto.subtle.verify("HMAC", key, copy.buffer, textEncoder.encode(value));
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const value of header.split(";")) {
    const [key, ...parts] = value.trim().split("=");
    if (key === name) return parts.join("=") || null;
  }
  return null;
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
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}
