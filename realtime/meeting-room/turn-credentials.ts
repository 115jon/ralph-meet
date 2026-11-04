export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

interface TurnLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface GenerateTurnCredentialsInput {
  tokenId: string;
  tokenSecret: string;
  fetch: typeof globalThis.fetch;
  log: TurnLogger;
}

const STUN_SERVER: IceServer = {
  urls: ["stun:stun.cloudflare.com:3478"],
};

const TURN_TTL_SECONDS = 48 * 60 * 60;

export async function generateTurnCredentials(
  input: GenerateTurnCredentialsInput,
): Promise<IceServer[]> {
  return (await requestTurnCredentials(input)) ?? [STUN_SERVER];
}

/** The TURN servers, or null when only the STUN fallback is available. */
async function requestTurnCredentials({
  tokenId,
  tokenSecret,
  fetch,
  log,
}: GenerateTurnCredentialsInput): Promise<IceServer[] | null> {
  if (!tokenId || !tokenSecret) return null;

  try {
    const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${tokenId}/credentials/generate-ice-servers`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      iceServers?: Array<{
        urls?: string[];
        username?: string;
        credential?: string;
      }>;
    };
    if (!Array.isArray(data.iceServers) || data.iceServers.length === 0) {
      return null;
    }

    const servers = data.iceServers
      .filter((server) => server.urls && server.urls.length > 0)
      .slice(0, 2)
      .map((server) => {
        const filteredUrls = (server.urls ?? []).filter(
          (serverUrl) =>
            serverUrl.includes(":3478?transport=udp") ||
            serverUrl.includes(":443?transport=tcp") ||
            serverUrl.startsWith("stun:"),
        );

        return {
          urls:
            filteredUrls.length > 0
              ? filteredUrls
              : (server.urls ?? []).slice(0, 2),
          username: server.username,
          credential: server.credential,
        };
      });

    log.info(
      `Generated TURN credentials, count=${servers.length}, flatUrls=${servers.flatMap((server) => server.urls).length}`,
    );
    return servers.length > 0 ? servers : null;
  } catch {
    log.warn("Failed generating TURN credentials, falling back to STUN");
    return null;
  }
}

/**
 * Generated credentials are reused for this long. They are not tied to a
 * user or session (any holder may use them until they expire, 48 h after
 * generation), so sharing one set between joins hands out nothing a join
 * could not get by itself; it only takes the Cloudflare TURN API round trip
 * off the join path. A client keeps credentials at least 47 h this way, and
 * refreshes them every 45 min.
 */
export const TURN_CREDENTIAL_CACHE_MS = 60 * 60 * 1000;

const turnCredentialCache = new Map<
  string,
  { servers: Promise<IceServer[] | null>; expiresAt: number }
>();

/**
 * {@link generateTurnCredentials}, shared per isolate for
 * {@link TURN_CREDENTIAL_CACHE_MS}. Concurrent callers share one request.
 * A STUN fallback (TURN not configured, or the API failed) is not kept, so
 * the next join asks again.
 */
export async function getCachedTurnCredentials(
  input: GenerateTurnCredentialsInput,
  now = Date.now(),
): Promise<IceServer[]> {
  if (!input.tokenId || !input.tokenSecret) return [STUN_SERVER];
  const key = input.tokenId;
  const cached = turnCredentialCache.get(key);
  if (cached && cached.expiresAt > now) {
    return (await cached.servers) ?? [STUN_SERVER];
  }
  const servers = requestTurnCredentials(input);
  const entry = { servers, expiresAt: now + TURN_CREDENTIAL_CACHE_MS };
  turnCredentialCache.set(key, entry);
  const resolved = await servers;
  if (!resolved && turnCredentialCache.get(key) === entry) {
    turnCredentialCache.delete(key);
  }
  return resolved ?? [STUN_SERVER];
}

export function clearTurnCredentialCacheForTests(): void {
  turnCredentialCache.clear();
}
