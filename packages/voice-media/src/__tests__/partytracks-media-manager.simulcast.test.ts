import type { TrackInfo } from "../track-info";
import type {
  RalphPublishedTrack,
  RalphPullOptions,
  RalphPushOptions,
} from "../partytracks-transport";
import { type Observable, Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import {
  PartyTracksMediaManager,
  type PartyTracksMediaTransport,
} from "../partytracks-media-manager";
import { CAMERA_SIMULCAST_ENCODINGS } from "../video-layers";
import { VideoRenderDemand } from "../video-render-demand";

const UPGRADE_MS = 150;
const DOWNGRADE_MS = 1_000;

const cameraOffer: TrackInfo = {
  participant_id: "publisher",
  track_name: "cam-video-publisher",
  sfu_track_name: "opaque-camera",
  session_id: "publisher-session",
  kind: "video",
  simulcast_rids: ["f", "h", "q"],
};

function mediaTrack(kind: "audio" | "video", id: string): MediaStreamTrack {
  return {
    id,
    kind,
    readyState: "live",
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
}

function mediaStream(...tracks: MediaStreamTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
  } as unknown as MediaStream;
}

class ManualTimers {
  private now = 0;
  private timers: Array<{ at: number; fn: () => void; live: boolean }> = [];

  readonly schedule = (fn: () => void, ms: number) => {
    const timer = { at: this.now + ms, fn, live: true };
    this.timers.push(timer);
    return () => {
      timer.live = false;
    };
  };

  pending(): number {
    return this.timers.filter((timer) => timer.live).length;
  }

  advance(ms: number): void {
    const end = this.now + ms;
    for (;;) {
      const due = this.timers
        .filter((timer) => timer.live && timer.at <= end)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.live = false;
      this.now = due.at;
      due.fn();
    }
    this.now = end;
  }
}

/** Records what the manager asks of PartyTracks, in order. */
class LayerTransport implements PartyTracksMediaTransport {
  readonly peerConnectionState$ = new Subject<RTCPeerConnectionState>();
  readonly pushOptions = new Map<string, RalphPushOptions | undefined>();
  readonly pushCount = new Map<string, number>();
  readonly pulledTracks = new Map<string, Subject<MediaStreamTrack>>();
  readonly pullOptions = new Map<string, RalphPullOptions | undefined>();
  /** Per alias: metadata and preferred RIDs as the pull saw them, in order. */
  readonly log = new Map<string, string[]>();
  /** Every pull's log, in order, with whether it asked for a fresh path. */
  readonly pulls: Array<{ log: string[]; fresh: boolean }> = [];
  pullCount = 0;

  push(
    _sourceTrack$: Observable<MediaStreamTrack>,
    identity: RalphPublishedTrack,
    options?: RalphPushOptions,
  ): Observable<TrackInfo> {
    this.pushOptions.set(identity.trackName, options);
    this.pushCount.set(
      identity.trackName,
      (this.pushCount.get(identity.trackName) ?? 0) + 1,
    );
    return new Subject<TrackInfo>();
  }

  pull(
    track$: Observable<TrackInfo>,
    options?: RalphPullOptions,
  ): Observable<MediaStreamTrack> {
    this.pullCount += 1;
    const log: string[] = [];
    let trackName = "";
    // PartyTracks reads the RID with withLatestFrom, which subscribes to it
    // before the metadata.
    options?.preferredRid$?.subscribe((rid) => log.push(`rid:${rid}`));
    track$.subscribe((track) => {
      trackName = track.track_name;
      log.push(`metadata:${track.sfu_track_name}`);
    });
    this.log.set(trackName, log);
    this.pulls.push({ log, fresh: options?.fresh === true });
    this.pullOptions.set(trackName, options);
    const pulled = new Subject<MediaStreamTrack>();
    this.pulledTracks.set(trackName, pulled);
    return pulled;
  }

  rids(trackName: string): string[] {
    return (this.log.get(trackName) ?? [])
      .filter((entry) => entry.startsWith("rid:"))
      .map((entry) => entry.slice("rid:".length));
  }
}

function setup() {
  const timers = new ManualTimers();
  const transport = new LayerTransport();
  const demand = new VideoRenderDemand();
  const remoteEvents: string[] = [];
  const manager = new PartyTracksMediaManager(
    transport,
    "viewer",
    {
      onPublicationMetadata: vi.fn(),
      onPublicationStopped: vi.fn(),
      onRemoteTrack: ({ action, track }) =>
        remoteEvents.push(`${action}:${track.id}`),
    },
    {
      schedule: timers.schedule,
      videoRenderDemand: demand,
      layerUpgradeDelayMs: UPGRADE_MS,
      layerDowngradeDelayMs: DOWNGRADE_MS,
    },
  );
  const tile = Symbol("tile");
  const remoteCamera = mediaTrack("video", "remote-camera");
  const shown = mediaStream(remoteCamera);
  return {
    timers,
    transport,
    demand,
    manager,
    remoteEvents,
    tile,
    render: (width: number, height: number) =>
      demand.report(tile, shown, { width, height }),
    rids: () => transport.rids(cameraOffer.track_name),
    arrive: () =>
      transport.pulledTracks.get(cameraOffer.track_name)?.next(remoteCamera),
  };
}

describe("PartyTracksMediaManager simulcast publishing", () => {
  it("pushes the camera as simulcast layers and everything else as one", () => {
    const { transport, manager } = setup();
    manager.publishStream(
      mediaStream(mediaTrack("audio", "mic"), mediaTrack("video", "camera")),
      "cam",
    );
    manager.publishStream(mediaStream(mediaTrack("video", "screen")), "screen");

    expect(transport.pushOptions.get("cam-video-viewer")).toEqual({
      sendEncodings: CAMERA_SIMULCAST_ENCODINGS,
    });
    expect(transport.pushOptions.get("cam-audio-viewer")).toBeUndefined();
    expect(transport.pushOptions.get("screen-video-viewer")).toBeUndefined();
  });

  it("republishes the camera with its simulcast layers", () => {
    const { transport, manager } = setup();
    manager.publishStream(mediaStream(mediaTrack("video", "camera")), "cam");
    expect(manager.republishTrack("cam-video-viewer")).toBe(true);
    expect(transport.pushCount.get("cam-video-viewer")).toBe(2);
    expect(transport.pushOptions.get("cam-video-viewer")).toEqual({
      sendEncodings: CAMERA_SIMULCAST_ENCODINGS,
    });
  });
});

describe("PartyTracksMediaManager simulcast layer selection", () => {
  it("pulls a simulcast camera at the low layer until something renders it", () => {
    const { transport, manager, rids, arrive, timers } = setup();
    manager.offerTracks([cameraOffer]);
    expect(transport.log.get(cameraOffer.track_name)).toEqual([
      "rid:q",
      "metadata:opaque-camera",
    ]);
    arrive();
    timers.advance(DOWNGRADE_MS * 2);
    expect(rids()).toEqual(["q"]);
    expect(manager.getRemoteVideoLayers()).toEqual({
      "cam-video-publisher": "q",
    });
  });

  it("pulls a single-layer camera (mobile, older clients) without naming a layer", () => {
    const { manager, rids, arrive, render, timers } = setup();
    manager.offerTracks([{ ...cameraOffer, simulcast_rids: undefined }]);
    arrive();
    render(1600, 900);
    timers.advance(DOWNGRADE_MS);
    expect(rids()).toEqual(["undefined"]);
    expect(manager.getRemoteVideoLayers()).toEqual({});
    expect(timers.pending()).toBe(0);
  });

  it("does not give audio pulls a layer", () => {
    const { transport, manager } = setup();
    manager.offerTracks([
      {
        ...cameraOffer,
        track_name: "cam-audio-publisher",
        kind: "audio",
        simulcast_rids: undefined,
      },
    ]);
    expect(transport.pullOptions.get("cam-audio-publisher")).toBeUndefined();
  });

  it("switches layers as the tile grows and shrinks, without re-pulling or replacing the track", () => {
    const { transport, manager, remoteEvents, rids, arrive, render, timers } =
      setup();
    manager.offerTracks([cameraOffer]);
    arrive();

    // Focused on stage: upgraded after the short delay.
    render(1600, 900);
    timers.advance(UPGRADE_MS - 1);
    expect(rids()).toEqual(["q"]);
    timers.advance(1);
    expect(rids()).toEqual(["q", "f"]);

    // Back to a grid tile: the downgrade waits longer.
    render(420, 236);
    timers.advance(DOWNGRADE_MS - 1);
    expect(rids()).toEqual(["q", "f"]);
    timers.advance(1);
    expect(rids()).toEqual(["q", "f", "h"]);

    expect(transport.pullCount).toBe(1);
    expect(
      transport.log
        .get(cameraOffer.track_name)
        ?.filter((entry) => entry.startsWith("metadata:")),
    ).toEqual(["metadata:opaque-camera"]);
    expect(remoteEvents).toEqual(["add:remote-camera"]);
  });

  it("debounces: a resize animation switches once, a brief shrink not at all", () => {
    const { manager, rids, arrive, render, timers } = setup();
    manager.offerTracks([cameraOffer]);
    arrive();

    for (let width = 400; width <= 1600; width += 40) {
      render(width, Math.round((width * 9) / 16));
      timers.advance(16);
    }
    timers.advance(UPGRADE_MS);
    expect(rids()).toEqual(["q", "f"]);

    render(200, 112);
    timers.advance(DOWNGRADE_MS / 2);
    render(1600, 900);
    timers.advance(DOWNGRADE_MS * 2);
    expect(rids()).toEqual(["q", "f"]);

    // Resizes inside the high layer's range do nothing.
    render(1200, 675);
    render(1920, 1080);
    timers.advance(DOWNGRADE_MS * 2);
    expect(rids()).toEqual(["q", "f"]);
  });

  it("switches many tiles once each when the grid reflows", () => {
    const timers = new ManualTimers();
    const transport = new LayerTransport();
    const demand = new VideoRenderDemand();
    const manager = new PartyTracksMediaManager(
      transport,
      "viewer",
      {
        onPublicationMetadata: vi.fn(),
        onPublicationStopped: vi.fn(),
        onRemoteTrack: vi.fn(),
      },
      {
        schedule: timers.schedule,
        videoRenderDemand: demand,
        layerUpgradeDelayMs: UPGRADE_MS,
        layerDowngradeDelayMs: DOWNGRADE_MS,
      },
    );
    const tiles = Array.from({ length: 9 }, (_, index) => {
      const offer = {
        ...cameraOffer,
        participant_id: `p${index}`,
        track_name: `cam-video-p${index}`,
        sfu_track_name: `opaque-${index}`,
      };
      manager.offerTracks([offer]);
      const track = mediaTrack("video", `camera-${index}`);
      transport.pulledTracks.get(offer.track_name)?.next(track);
      return {
        offer,
        owner: Symbol(offer.track_name),
        stream: mediaStream(track),
      };
    });

    // Window resize: every tile reports every frame for a while.
    for (let frame = 0; frame < 30; frame += 1) {
      for (const tile of tiles) {
        demand.report(tile.owner, tile.stream, {
          width: 300 + frame * 10,
          height: 170 + frame * 6,
        });
      }
      timers.advance(16);
    }
    timers.advance(UPGRADE_MS);

    for (const tile of tiles) {
      expect(transport.rids(tile.offer.track_name)).toEqual(["q", "h"]);
    }
    expect(transport.pullCount).toBe(9);
  });

  it("drops to the low layer once nothing renders the camera", () => {
    const { manager, demand, rids, arrive, render, timers, tile } = setup();
    manager.offerTracks([cameraOffer]);
    arrive();
    render(1600, 900);
    timers.advance(UPGRADE_MS);
    demand.withdraw(tile);
    timers.advance(DOWNGRADE_MS);
    expect(rids()).toEqual(["q", "f", "q"]);
  });

  it("pulls a new publication afresh at the layer its alias was shown at", () => {
    const { transport, manager, arrive, render, timers } = setup();
    manager.offerTracks([cameraOffer]);
    arrive();
    render(1600, 900);
    timers.advance(UPGRADE_MS);

    // Republished by a client without simulcast: no layer for the re-pull.
    manager.offerTracks([
      {
        ...cameraOffer,
        sfu_track_name: "opaque-camera-2",
        simulcast_rids: undefined,
      },
    ]);
    // And back to a simulcast publisher: its current layer again.
    manager.offerTracks([
      { ...cameraOffer, sfu_track_name: "opaque-camera-3" },
    ]);

    // Each SFU track is pulled on a fresh path, asking for the layer the
    // tile needed before its metadata.
    expect(transport.pulls).toEqual([
      {
        log: ["rid:q", "metadata:opaque-camera", "rid:f"],
        fresh: false,
      },
      { log: ["rid:undefined", "metadata:opaque-camera-2"], fresh: true },
      { log: ["rid:f", "metadata:opaque-camera-3"], fresh: true },
    ]);
  });

  it("cancels a pending layer change when the pull stops", () => {
    const { manager, rids, arrive, render, timers } = setup();
    manager.offerTracks([cameraOffer]);
    arrive();
    render(1600, 900);
    expect(timers.pending()).toBe(1);
    manager.stopRemoteTracks([cameraOffer.track_name]);
    expect(timers.pending()).toBe(0);
    expect(rids()).toEqual(["q"]);
  });

  it("stops listening for renders when disposed", () => {
    const { manager, timers, render, arrive } = setup();
    manager.offerTracks([cameraOffer]);
    arrive();
    manager.dispose();
    render(1600, 900);
    expect(timers.pending()).toBe(0);
  });
});
