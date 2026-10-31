import { routePartyTracksRequest } from "partytracks/server";
import { verifyVoiceToken } from "./voice-token";
import {
  VOICE_MEDIA_AUTHORIZATION_PATH,
  serializeVoiceJoinGrantQuery,
} from "./voice-join-grant";

const PARTICIPANT_HEADER = "X-Voice-Session-Id";
const PARTYTRACKS_PATH = /^\/api\/channels\/([^/]+)\/partytracks(?:\/|$)/;
const CAPABILITY_VERSION = 1;

export interface PartyTracksProxyEnv {
  CALLS_APP_ID: string;
  CALLS_APP_SECRET: string;
  CALLS_API_URL?: string;
  TURN_TOKEN_ID?: string;
  TURN_TOKEN_SECRET?: string;
  VOICE_ROOM?: DurableObjectNamespace;
}

export interface RemotePullAuthorizationInput {
  roomSlug: string;
  participantId: string;
  subject: string;
}

/** Answers whether a participant may pull other participants' tracks. */
export type RemotePullAuthorizer = (
  input: RemotePullAuthorizationInput,
  env: PartyTracksProxyEnv,
) => Promise<boolean>;

export interface PartyTracksProxyOptions {
  authorizeRemotePull?: RemotePullAuthorizer;
}

/**
 * Pulling another participant's track requires a join grant in the channel's
 * VoiceRoom, which the MeetingRoom pushes when the session joins and revokes
 * when it leaves. A voice token alone (for example a standby session's) is
 * not enough.
 */
export const authorizeRemotePullWithVoiceRoom: RemotePullAuthorizer = async (
  { roomSlug, participantId, subject },
  env,
) => {
  const namespace = env.VOICE_ROOM;
  if (!namespace) return false;
  try {
    const response = await namespace
      .get(namespace.idFromName(roomSlug))
      .fetch(`https://internal${VOICE_MEDIA_AUTHORIZATION_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: serializeVoiceJoinGrantQuery({ participantId, subject }),
      });
    if (!response.ok) return false;
    const body = (await response.json()) as { authorized?: unknown };
    return body.authorized === true;
  } catch {
    return false;
  }
};

export interface PartyTracksRouteOptions {
  appId: string;
  token: string;
  request: Request;
  prefix: string;
  realtimeApiBaseUrl?: string;
  lockSessionToInitiator: boolean;
  turnServerAppId?: string;
  turnServerAppToken?: string;
}

export type PartyTracksRouter = (
  options: PartyTracksRouteOptions,
) => Promise<Response>;

export interface PartyTracksSessionCapabilityClaims {
  version: typeof CAPABILITY_VERSION;
  roomSlug: string;
  participantId: string;
  sessionId: string;
}

function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

function forbidden(): Response {
  return Response.json({ error: "Forbidden" }, { status: 403 });
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  try {
    return Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0),
    );
  } catch {
    return null;
  }
}

async function importCapabilityKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function issueSessionCapability(
  claims: PartyTracksSessionCapabilityClaims,
  secret: string,
): Promise<string> {
  const payload = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(claims)),
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importCapabilityKey(secret),
    new TextEncoder().encode(payload),
  );
  return `${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

function isSessionCapabilityClaims(
  value: unknown,
): value is PartyTracksSessionCapabilityClaims {
  if (!value || typeof value !== "object") return false;
  const claims = value as Record<string, unknown>;
  return (
    claims.version === CAPABILITY_VERSION &&
    typeof claims.roomSlug === "string" &&
    claims.roomSlug.length > 0 &&
    claims.roomSlug.length <= 512 &&
    typeof claims.participantId === "string" &&
    claims.participantId.length > 0 &&
    claims.participantId.length <= 512 &&
    typeof claims.sessionId === "string" &&
    claims.sessionId.length > 0 &&
    claims.sessionId.length <= 512
  );
}

export async function verifyPartyTracksSessionCapability(
  capability: string,
  secret: string,
): Promise<PartyTracksSessionCapabilityClaims | null> {
  if (capability.length > 4_096) return null;
  const parts = capability.split(".");
  if (parts.length !== 2) return null;
  const [payload, encodedSignature] = parts;
  if (!payload || !encodedSignature) return null;
  const signature = base64UrlToBytes(encodedSignature);
  const payloadBytes = base64UrlToBytes(payload);
  if (!signature || !payloadBytes) return null;
  const signatureBytes = new Uint8Array(signature.byteLength);
  signatureBytes.set(signature);

  const valid = await crypto.subtle.verify(
    "HMAC",
    await importCapabilityKey(secret),
    signatureBytes,
    new TextEncoder().encode(payload),
  );
  if (!valid) return null;

  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(payloadBytes));
    return isSessionCapabilityClaims(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function decodeSessionReferences(
  value: unknown,
  roomSlug: string,
  secret: string,
  capabilitiesBySession: Map<string, string>,
  referencedParticipants: Set<string>,
): Promise<unknown> {
  if (Array.isArray(value)) {
    return Promise.all(
      value.map((entry) =>
        decodeSessionReferences(
          entry,
          roomSlug,
          secret,
          capabilitiesBySession,
          referencedParticipants,
        ),
      ),
    );
  }
  if (!value || typeof value !== "object") return value;

  const decoded: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "sessionId" && typeof entry === "string") {
      const claims = await verifyPartyTracksSessionCapability(entry, secret);
      if (!claims || claims.roomSlug !== roomSlug) {
        throw new Error("INVALID_SESSION_CAPABILITY");
      }
      capabilitiesBySession.set(claims.sessionId, entry);
      referencedParticipants.add(claims.participantId);
      decoded[key] = claims.sessionId;
    } else {
      decoded[key] = await decodeSessionReferences(
        entry,
        roomSlug,
        secret,
        capabilitiesBySession,
        referencedParticipants,
      );
    }
  }
  return decoded;
}

function restoreSessionReferences(
  value: unknown,
  capabilitiesBySession: ReadonlyMap<string, string>,
): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      restoreSessionReferences(entry, capabilitiesBySession),
    );
  }
  if (!value || typeof value !== "object") return value;

  const restored: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "sessionId" && typeof entry === "string") {
      restored[key] = capabilitiesBySession.get(entry) ?? entry;
    } else {
      restored[key] = restoreSessionReferences(entry, capabilitiesBySession);
    }
  }
  return restored;
}

async function rewriteJsonResponse(
  response: Response,
  transform: (value: unknown) => unknown | Promise<unknown>,
): Promise<Response> {
  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.delete("Content-Length");
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(await transform(body)), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function readBearerToken(request: Request): string | null {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length).trim();
  return token || null;
}

/**
 * Authenticated PartyTracks proxy for the root Worker.
 *
 * PartyTracks' built-in initiator lock uses a SameSite cookie, which cannot be
 * returned by the deployed Worker to the Tauri origin. Ralph therefore uses a
 * signed, participant-bound session capability in place of the raw Cloudflare
 * session id. Remote capabilities may be referenced for pulls, while only the
 * owner may place a capability in the mutable session URL.
 *
 * Creating a session and pushing local tracks only need the voice token: that
 * is how a standby session warms up, and a push stays private until the
 * VoiceRoom (join-gated) announces it. Pulls of other participants' tracks
 * also need a join grant.
 */
export async function handlePartyTracksProxyRequest(
  request: Request,
  env: PartyTracksProxyEnv,
  route: PartyTracksRouter = routePartyTracksRequest,
  options: PartyTracksProxyOptions = {},
): Promise<Response | null> {
  const url = new URL(request.url);
  const pathMatch = PARTYTRACKS_PATH.exec(url.pathname);
  if (!pathMatch) return null;

  let roomSlug: string;
  try {
    roomSlug = decodeURIComponent(pathMatch[1] ?? "");
  } catch {
    return forbidden();
  }
  const participantId = request.headers.get(PARTICIPANT_HEADER)?.trim();
  const voiceToken = readBearerToken(request);
  if (!roomSlug || !participantId || !voiceToken) return unauthorized();
  if (!env.CALLS_APP_ID || !env.CALLS_APP_SECRET) {
    return Response.json(
      { error: "PartyTracks is not configured" },
      { status: 503 },
    );
  }

  const verification = await verifyVoiceToken({
    token: voiceToken,
    participantId,
    roomSlug,
    secret: env.CALLS_APP_SECRET,
  });
  if (!verification.ok) return unauthorized();

  const encodedRoomSlug = pathMatch[1] ?? "";
  const prefix = `/api/channels/${encodedRoomSlug}/partytracks`;
  const newSessionPath = `${prefix}/sessions/new`;
  const sessionPathPrefix = `${prefix}/sessions/`;
  const capabilitiesBySession = new Map<string, string>();
  const referencedParticipants = new Set<string>();
  const routedUrl = new URL(url);

  if (
    routedUrl.pathname.startsWith(sessionPathPrefix) &&
    routedUrl.pathname !== newSessionPath
  ) {
    const suffix = routedUrl.pathname.slice(sessionPathPrefix.length);
    const slashIndex = suffix.indexOf("/");
    const encodedCapability =
      slashIndex === -1 ? suffix : suffix.slice(0, slashIndex);
    let capability: string;
    try {
      capability = decodeURIComponent(encodedCapability);
    } catch {
      return forbidden();
    }
    const claims = await verifyPartyTracksSessionCapability(
      capability,
      env.CALLS_APP_SECRET,
    );
    if (
      !claims ||
      claims.roomSlug !== roomSlug ||
      claims.participantId !== participantId
    ) {
      return forbidden();
    }
    capabilitiesBySession.set(claims.sessionId, capability);
    const remainder = slashIndex === -1 ? "" : suffix.slice(slashIndex);
    routedUrl.pathname = `${sessionPathPrefix}${encodeURIComponent(claims.sessionId)}${remainder}`;
  }

  const headers = new Headers(request.headers);
  headers.delete("Authorization");
  headers.delete(PARTICIPANT_HEADER);
  headers.delete("Cookie");
  headers.delete("Content-Length");

  let body: string | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const rawBody = await request.text();
    if (rawBody) {
      try {
        const parsed: unknown = JSON.parse(rawBody);
        body = JSON.stringify(
          await decodeSessionReferences(
            parsed,
            roomSlug,
            env.CALLS_APP_SECRET,
            capabilitiesBySession,
            referencedParticipants,
          ),
        );
        headers.set("Content-Type", "application/json");
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "INVALID_SESSION_CAPABILITY"
        ) {
          return forbidden();
        }
        body = rawBody;
      }
    }
  }
  referencedParticipants.delete(participantId);
  let pullAuthorizationMs: number | null = null;
  if (referencedParticipants.size > 0) {
    const authorize =
      options.authorizeRemotePull ?? authorizeRemotePullWithVoiceRoom;
    const startedAt = performance.now();
    const authorized = await authorize(
      { roomSlug, participantId, subject: verification.subject },
      env,
    );
    pullAuthorizationMs = performance.now() - startedAt;
    if (!authorized) return forbidden();
  }

  if (body !== undefined) {
    // partytracks/server uses this header to decide whether to forward the
    // request stream, so recompute it after rewriting session capabilities.
    headers.set(
      "Content-Length",
      String(new TextEncoder().encode(body).byteLength),
    );
  }

  const routedRequest = new Request(routedUrl, {
    method: request.method,
    headers,
    body,
    redirect: request.redirect,
  });
  const routedResponse = await route({
    appId: env.CALLS_APP_ID,
    token: env.CALLS_APP_SECRET,
    realtimeApiBaseUrl: env.CALLS_API_URL,
    request: routedRequest,
    prefix,
    lockSessionToInitiator: false,
    turnServerAppId: env.TURN_TOKEN_ID,
    turnServerAppToken: env.TURN_TOKEN_SECRET,
  });

  if (url.pathname === newSessionPath && routedResponse.ok) {
    return rewriteJsonResponse(routedResponse, async (value) => {
      if (!value || typeof value !== "object") return value;
      const responseBody = value as Record<string, unknown>;
      const sessionId = responseBody.sessionId;
      if (typeof sessionId !== "string" || !sessionId) return value;
      const capability = await issueSessionCapability(
        {
          version: CAPABILITY_VERSION,
          roomSlug,
          participantId,
          sessionId,
        },
        env.CALLS_APP_SECRET,
      );
      return { ...responseBody, sessionId: capability };
    });
  }

  const response = await rewriteJsonResponse(routedResponse, (value) =>
    restoreSessionReferences(value, capabilitiesBySession),
  );
  if (pullAuthorizationMs === null) return response;
  // Durations only: lets `pnpm bench:voice` see what the join check costs.
  const timed = new Response(response.body, response);
  timed.headers.append(
    "Server-Timing",
    `voice-join;dur=${pullAuthorizationMs.toFixed(1)}`,
  );
  return timed;
}
