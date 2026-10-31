import type { ApiHistoryEntry } from "partytracks/client";
import { Observable } from "rxjs";

/**
 * The SFU's answer when a pulled track does not exist (never registered, or
 * garbage-collected; see publication-liveness).
 */
export const SFU_TRACK_NOT_FOUND = "not_found_track_error";

/** One SFU error for one remote track a pull asked for. */
export interface PartyTracksPullError {
  /** The publisher's SFU session id, as the pull named it. */
  readonly sessionId: string;
  /** The SFU track name, as the pull named it. */
  readonly trackName: string;
  readonly errorCode: string;
}

/**
 * PartyTracks' API log (`PartyTracks.history`): every request body and
 * response body, in order, with a `logentry` event after each.
 */
export interface PartyTracksApiHistory {
  readonly entries: readonly ApiHistoryEntry[];
  addEventListener(type: "logentry", callback: (event: Event) => void): void;
  removeEventListener(type: "logentry", callback: (event: Event) => void): void;
}

interface RequestedTrack {
  readonly sessionId: string;
  readonly trackName: string;
}

interface ResponseTrack {
  readonly sessionId?: unknown;
  readonly trackName?: unknown;
  readonly errorCode?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTracksNewEndpoint(endpoint: string): boolean {
  return /\/sessions\/[^/?]+\/tracks\/new(?:\?|$)/.test(endpoint);
}

/** The remote tracks a tracks/new request pulls; [] for a push. */
function pulledTracksOf(body: unknown): RequestedTrack[] {
  if (!isRecord(body) || body.sessionDescription !== undefined) return [];
  if (!Array.isArray(body.tracks)) return [];
  const pulled: RequestedTrack[] = [];
  for (const track of body.tracks) {
    if (
      isRecord(track) &&
      track.location === "remote" &&
      typeof track.sessionId === "string" &&
      typeof track.trackName === "string"
    ) {
      pulled.push({ sessionId: track.sessionId, trackName: track.trackName });
    }
  }
  return pulled;
}

/**
 * The error of each requested track: its own entry's errorCode, else the
 * response's top-level errorCode when its entry is missing or failed.
 */
function pullErrorsOf(
  body: unknown,
  requested: readonly RequestedTrack[],
): PartyTracksPullError[] {
  if (!isRecord(body) || requested.length === 0) return [];
  const responseTracks: ResponseTrack[] = Array.isArray(body.tracks)
    ? body.tracks.filter(isRecord)
    : [];
  const topLevelCode =
    typeof body.errorCode === "string" ? body.errorCode : undefined;
  const errors: PartyTracksPullError[] = [];
  for (const track of requested) {
    const entry =
      responseTracks.find(
        (candidate) =>
          candidate.trackName === track.trackName &&
          candidate.sessionId === track.sessionId,
      ) ??
      // A lone failed entry need not echo the names back.
      (requested.length === 1 && responseTracks.length === 1
        ? responseTracks[0]
        : undefined);
    const errorCode =
      typeof entry?.errorCode === "string" ? entry.errorCode : topLevelCode;
    if (errorCode) errors.push({ ...track, errorCode });
  }
  return errors;
}

/**
 * The SFU errors PartyTracks' pulls get, per requested track. PartyTracks
 * retries a failed pull internally (retryWithBackoff) and never surfaces the
 * error code, but it logs each request and response body to its history:
 * pair every tracks/new response with the pull request before it. Pushes and
 * pulls share one FIFO task queue in PartyTracks, so the requests to one
 * tracks/new endpoint never overlap.
 */
export function observePullErrors(
  history: PartyTracksApiHistory,
): Observable<PartyTracksPullError> {
  return new Observable((subscriber) => {
    const pendingPulls = new Map<string, RequestedTrack[]>();
    const onEntry = (event: Event) => {
      // Typed as carrying the entry; the 0.0.56 build dispatches a bare
      // CustomEvent right after appending it.
      const entry =
        (event as Event & { entry?: ApiHistoryEntry }).entry ??
        history.entries.at(-1);
      if (!entry || !isTracksNewEndpoint(entry.endpoint)) return;
      if (entry.type === "request") {
        pendingPulls.set(entry.endpoint, pulledTracksOf(entry.body));
        return;
      }
      const requested = pendingPulls.get(entry.endpoint) ?? [];
      pendingPulls.delete(entry.endpoint);
      for (const error of pullErrorsOf(entry.body, requested)) {
        subscriber.next(error);
      }
    };
    history.addEventListener("logentry", onEntry);
    return () => history.removeEventListener("logentry", onEntry);
  });
}
