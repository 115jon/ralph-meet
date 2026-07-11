import type { ListenTogetherRadioTrack } from "../../src/lib/listen-together";

interface RadioBrowserStation {
  stationuuid?: unknown;
  name?: unknown;
  url_resolved?: unknown;
  homepage?: unknown;
  favicon?: unknown;
}

interface RadioStationResolverOptions {
  fetch: typeof globalThis.fetch;
  now?: () => number;
  cacheTtlMs?: number;
  maxResolutionsPerWindow?: number;
  resolutionWindowMs?: number;
  fetchTimeoutMs?: number;
}

const RADIO_BROWSER_API_HOST = "de1.api.radio-browser.info";
const DEFAULT_CACHE_TTL_MS = 60_000;
const DEFAULT_MAX_RESOLUTIONS_PER_WINDOW = 10;
const DEFAULT_RESOLUTION_WINDOW_MS = 60_000;
const DEFAULT_FETCH_TIMEOUT_MS = 5_000;

export class RadioStationResolver {
  private readonly cache = new Map<
    string,
    { expiresAt: number; station: ListenTogetherRadioTrack | null }
  >();
  private readonly inFlight = new Map<
    string,
    Promise<ListenTogetherRadioTrack | null>
  >();
  private readonly attempts = new Map<string, number[]>();
  private readonly now: () => number;
  private readonly cacheTtlMs: number;
  private readonly maxResolutionsPerWindow: number;
  private readonly resolutionWindowMs: number;
  private readonly fetchTimeoutMs: number;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: RadioStationResolverOptions) {
    this.fetch = options.fetch;
    this.now = options.now ?? Date.now;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.maxResolutionsPerWindow =
      options.maxResolutionsPerWindow ?? DEFAULT_MAX_RESOLUTIONS_PER_WINDOW;
    this.resolutionWindowMs =
      options.resolutionWindowMs ?? DEFAULT_RESOLUTION_WINDOW_MS;
    this.fetchTimeoutMs = options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  }

  async resolve(
    stationUuid: string,
    callerUserId: string | null,
  ): Promise<ListenTogetherRadioTrack | null> {
    const cached = this.cache.get(stationUuid);
    if (cached && cached.expiresAt > this.now()) return cached.station;

    const inFlight = this.inFlight.get(stationUuid);
    if (inFlight) return inFlight;
    if (!this.canResolveForUser(callerUserId)) return null;

    const resolution = this.fetchStation(stationUuid);
    this.inFlight.set(stationUuid, resolution);
    try {
      return await resolution;
    } finally {
      this.inFlight.delete(stationUuid);
    }
  }

  private canResolveForUser(userId: string | null) {
    const now = this.now();
    const key = userId ?? "anonymous";
    const attempts = (this.attempts.get(key) ?? []).filter(
      (attemptedAt) => now - attemptedAt < this.resolutionWindowMs,
    );
    if (attempts.length >= this.maxResolutionsPerWindow) return false;
    attempts.push(now);
    this.attempts.set(key, attempts);
    return true;
  }

  private async fetchStation(stationUuid: string) {
    let resolvedStation: ListenTogetherRadioTrack | null = null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.fetchTimeoutMs);
    try {
      const response = await this.fetch(
        `https://${RADIO_BROWSER_API_HOST}/json/stations/byuuid/${encodeURIComponent(stationUuid)}`,
        { signal: controller.signal },
      );
      if (!response.ok) return null;
      const stations = (await response.json()) as unknown;
      if (!Array.isArray(stations) || stations.length !== 1) return null;
      const station = stations[0] as RadioBrowserStation;
      if (station.stationuuid !== stationUuid) return null;

      const title =
        typeof station.name === "string"
          ? station.name.trim().slice(0, 160)
          : "";
      const streamUrl = this.sanitizePublicHttpsUrl(station.url_resolved);
      if (!title || !streamUrl) return null;

      resolvedStation = {
        kind: "radio",
        id: stationUuid,
        provider: "radio",
        title,
        artworkUrl: this.sanitizePublicHttpsUrl(station.favicon)?.href,
        canonicalUrl:
          this.sanitizePublicHttpsUrl(station.homepage)?.href ??
          streamUrl.origin,
        streamUrl: streamUrl.href,
        sourceLabel: "Live Radio",
      };
    } catch {
      resolvedStation = null;
    } finally {
      clearTimeout(timeout);
    }
    this.cache.set(stationUuid, {
      expiresAt: this.now() + this.cacheTtlMs,
      station: resolvedStation,
    });
    return resolvedStation;
  }

  private sanitizePublicHttpsUrl(value: unknown): URL | null {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > 2048
    ) {
      return null;
    }
    try {
      const url = new URL(value);
      const hostname = url.hostname.toLowerCase();
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".local") ||
        this.isPrivateIpLiteral(hostname)
      ) {
        return null;
      }
      return url;
    } catch {
      return null;
    }
  }

  private isPrivateIpLiteral(hostname: string) {
    const ipv4 = hostname.match(/^([0-9.]+)$/);
    if (ipv4) {
      const octets = hostname.split(".").map(Number);
      if (octets.length !== 4 || octets.some((octet) => octet > 255))
        return true;
      const [first, second] = octets;
      return (
        first === 0 ||
        first === 10 ||
        first === 127 ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168)
      );
    }
    return hostname.includes(":");
  }
}
