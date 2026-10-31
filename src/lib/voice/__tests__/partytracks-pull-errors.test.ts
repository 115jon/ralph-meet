import type { ApiHistoryEntry } from "partytracks/client";
import { describe, expect, it } from "vitest";
import {
  observePullErrors,
  type PartyTracksApiHistory,
  type PartyTracksPullError,
} from "../partytracks-pull-errors";

/** PartyTracks' History as 0.0.56 ships it: append, then a bare event. */
class FakeHistory extends EventTarget implements PartyTracksApiHistory {
  readonly entries: ApiHistoryEntry[] = [];

  log(entry: ApiHistoryEntry): void {
    this.entries.push(entry);
    this.dispatchEvent(new CustomEvent("logentry"));
  }
}

const TRACKS_NEW = "/api/channels/room/partytracks/sessions/L/tracks/new?";

function observe(history: FakeHistory): PartyTracksPullError[] {
  const errors: PartyTracksPullError[] = [];
  observePullErrors(history).subscribe((error) => errors.push(error));
  return errors;
}

function pull(history: FakeHistory, tracks: unknown[], response: unknown) {
  history.log({
    type: "request",
    method: "POST",
    endpoint: TRACKS_NEW,
    body: { tracks },
  });
  history.log({ type: "response", endpoint: TRACKS_NEW, body: response });
}

const remote = (trackName: string, sessionId = "J") => ({
  location: "remote",
  trackName,
  sessionId,
});

describe("observePullErrors", () => {
  it("attributes per-track errors of a batched pull to their tracks", () => {
    const history = new FakeHistory();
    const errors = observe(history);
    pull(history, [remote("a"), remote("b"), remote("c", "K")], {
      tracks: [
        { trackName: "a", sessionId: "J", mid: "1" },
        {
          trackName: "b",
          sessionId: "J",
          errorCode: "not_found_track_error",
        },
        {
          trackName: "c",
          sessionId: "K",
          errorCode: "not_found_track_error",
        },
      ],
    });
    expect(errors).toEqual([
      { sessionId: "J", trackName: "b", errorCode: "not_found_track_error" },
      { sessionId: "K", trackName: "c", errorCode: "not_found_track_error" },
    ]);
  });

  it("gives a top-level error to every track of the request", () => {
    const history = new FakeHistory();
    const errors = observe(history);
    pull(history, [remote("a"), remote("b")], {
      errorCode: "not_found_track_error",
    });
    expect(errors.map((error) => error.trackName)).toEqual(["a", "b"]);
  });

  it("ignores pushes, successes, other endpoints and unmatched responses", () => {
    const history = new FakeHistory();
    const errors = observe(history);
    history.log({
      type: "request",
      method: "POST",
      endpoint: TRACKS_NEW,
      body: {
        sessionDescription: { type: "offer", sdp: "v=0" },
        tracks: [{ location: "local", trackName: "mine", mid: "0" }],
      },
    });
    history.log({
      type: "response",
      endpoint: TRACKS_NEW,
      body: { errorCode: "invalid_request_error" },
    });
    pull(history, [remote("a")], {
      tracks: [{ trackName: "a", sessionId: "J", mid: "1" }],
    });
    history.log({
      type: "response",
      endpoint: TRACKS_NEW,
      body: { errorCode: "not_found_track_error" },
    });
    history.log({
      type: "response",
      endpoint: "/api/channels/room/partytracks/sessions/L/renegotiate?",
      body: { errorCode: "not_found_track_error" },
    });
    expect(errors).toEqual([]);
  });

  it("stops listening when unsubscribed", () => {
    const history = new FakeHistory();
    const errors: PartyTracksPullError[] = [];
    observePullErrors(history)
      .subscribe((error) => errors.push(error))
      .unsubscribe();
    pull(history, [remote("a")], { errorCode: "not_found_track_error" });
    expect(errors).toEqual([]);
  });
});
