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

export async function generateTurnCredentials({
  tokenId,
  tokenSecret,
  fetch,
  log,
}: GenerateTurnCredentialsInput): Promise<IceServer[]> {
  if (!tokenId || !tokenSecret) return [STUN_SERVER];

  try {
    const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${tokenId}/credentials/generate-ice-servers`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl: 48 * 60 * 60 }),
    });

    if (!response.ok) return [STUN_SERVER];

    const data = (await response.json()) as {
      iceServers?: Array<{
        urls?: string[];
        username?: string;
        credential?: string;
      }>;
    };
    if (!Array.isArray(data.iceServers) || data.iceServers.length === 0) {
      return [STUN_SERVER];
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
    return servers.length > 0 ? servers : [STUN_SERVER];
  } catch {
    log.warn("Failed generating TURN credentials, falling back to STUN");
    return [STUN_SERVER];
  }
}
