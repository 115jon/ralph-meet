import {
  type ClientMessage,
  type IceServer,
  type NegotiationDonePayload,
  type SessionDescriptionPayload,
} from "@/lib/types";
import { GatewayOp } from "@/lib/gateway-protocol";
import { VoiceGateway } from "@/lib/voice/gateways/voice-gateway";
import {
  NativeScreenShareTransport,
  type NativeScreenShareInvoke,
  type NativeScreenShareOptions,
} from "@/lib/voice/native-screen-share-transport";
import { describe, expect, it, vi } from "vitest";

const initialOptions: NativeScreenShareOptions = {
  sourceId: "screen:1",
  sourceName: "Primary display",
  quality: "1080p",
  withAudio: true,
};

function createDeferred<T>() {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
}

function createFixture() {
  const gateway = new VoiceGateway();
  const sentMessages: ClientMessage[] = [];
  vi.spyOn(gateway, "send").mockImplementation((message) => {
    sentMessages.push(message);
    return true;
  });
  const invoke = vi.fn<NativeScreenShareInvoke>(async (command) => {
    if (command === "start_native_screen_share") {
      return { sdp: "native-offer", type: "offer" };
    }
    if (command === "wait_native_screen_share_connected") {
      return "connected";
    }
    return undefined;
  });
  const iceServers: IceServer[] = [{ urls: ["stun:example.test"] }];
  const transport = new NativeScreenShareTransport({
    gateway,
    getIceServers: () => iceServers,
    getParticipantId: () => "local-participant",
    invoke,
    isVoiceReady: () => true,
    waitForVoiceReady: () => Promise.resolve(),
  });
  return { gateway, invoke, sentMessages, transport };
}

function selectProtocolMessages(messages: ClientMessage[]) {
  return messages.filter(
    (
      message,
    ): message is Extract<ClientMessage, { op: GatewayOp.SelectProtocol }> =>
      message.op === GatewayOp.SelectProtocol,
  );
}

async function completeStart(
  fixture: ReturnType<typeof createFixture>,
  startPromise: Promise<void>,
  selectIndex: number,
) {
  await vi.waitFor(() => {
    expect(selectProtocolMessages(fixture.sentMessages)).toHaveLength(
      selectIndex + 1,
    );
  });
  const select = selectProtocolMessages(fixture.sentMessages)[selectIndex];
  if (!select) throw new Error("Native SelectProtocol was not sent");
  const requestId = select.d.request_id;
  if (!requestId) throw new Error("Native SelectProtocol has no request id");

  fixture.gateway.emit("session-description", {
    operation: "push",
    push_prefix: "screen",
    request_id: requestId,
    sdp: "native-answer",
    sdp_type: "answer",
    session_id: `session-${selectIndex}`,
    tracks: [],
  });
  fixture.gateway.emit("negotiation-done", {
    operation: "push",
    push_prefix: "screen",
    request_id: requestId,
    session_id: `session-${selectIndex}`,
  });
  await startPromise;
  return requestId;
}

describe("NativeScreenShareTransport", () => {
  it("owns native SelectProtocol, answer, NegotiationDone, and TracksReady", async () => {
    const fixture = createFixture();
    const startPromise = fixture.transport.start(initialOptions);
    await vi.waitFor(() => {
      expect(selectProtocolMessages(fixture.sentMessages)).toHaveLength(1);
    });
    const select = selectProtocolMessages(fixture.sentMessages)[0];
    if (!select) throw new Error("Native SelectProtocol was not sent");
    const requestId = select.d.request_id;
    if (!requestId) throw new Error("Native SelectProtocol has no request id");

    fixture.gateway.emit("session-description", {
      operation: "push",
      push_prefix: "cam",
      request_id: requestId,
      sdp: "unrelated-answer",
      sdp_type: "answer",
      session_id: "unrelated-session",
      tracks: [],
    } as unknown as SessionDescriptionPayload);
    fixture.gateway.emit("negotiation-done", {
      operation: "pull",
      request_id: requestId,
      session_id: "unrelated-session",
    } as unknown as NegotiationDonePayload);
    await Promise.resolve();
    expect(
      fixture.invoke.mock.calls.some(
        ([command]) => command === "handle_sdp_answer",
      ),
    ).toBe(false);
    expect(
      fixture.sentMessages.some(
        (message) => message.op === GatewayOp.TracksReady,
      ),
    ).toBe(false);

    await completeStart(fixture, startPromise, 0);

    expect(select.d).toEqual({
      sdp: "native-offer",
      push_tracks: [
        {
          track_name: "screen-video-local-participant",
          mid: "0",
          kind: "video",
        },
        {
          track_name: "screen-audio-local-participant",
          mid: "1",
          kind: "audio",
        },
      ],
      pull_tracks: [],
      push_prefix: "screen",
      request_id: requestId,
    });
    expect(fixture.invoke).toHaveBeenCalledWith("handle_sdp_answer", {
      sdp: "native-answer",
    });
    expect(fixture.invoke).toHaveBeenCalledWith(
      "wait_native_screen_share_connected",
      { timeoutMs: 10000 },
    );
    expect(fixture.sentMessages.at(-1)).toEqual({
      op: GatewayOp.TracksReady,
      d: {
        track_names: [
          "screen-video-local-participant",
          "screen-audio-local-participant",
        ],
      },
    });
    expect(fixture.transport.active).toBe(true);
  });

  it("stops native capture after a post-start invalid offer without signaling tracks", async () => {
    const fixture = createFixture();
    fixture.invoke.mockImplementation(async (command) => {
      if (command === "start_native_screen_share") {
        return { sdp: "invalid-native-answer", type: "answer" };
      }
      return undefined;
    });

    await expect(fixture.transport.start(initialOptions)).rejects.toThrow(
      "Native screen share returned an invalid SDP offer",
    );

    expect(
      fixture.invoke.mock.calls.filter(
        ([command]) => command === "stop_native_screen_share",
      ),
    ).toHaveLength(1);
    expect(fixture.sentMessages).toEqual([]);
    expect(fixture.transport.active).toBe(false);

    await fixture.transport.stop();
    expect(
      fixture.invoke.mock.calls.filter(
        ([command]) => command === "stop_native_screen_share",
      ),
    ).toHaveLength(1);
  });

  it("cleans up owned native tracks when connection confirmation fails", async () => {
    const fixture = createFixture();
    const connectionError = new Error("Native connection confirmation failed");
    fixture.invoke.mockImplementation(async (command) => {
      if (command === "start_native_screen_share") {
        return { sdp: "native-offer", type: "offer" };
      }
      if (command === "wait_native_screen_share_connected") {
        throw connectionError;
      }
      return undefined;
    });

    const startPromise = fixture.transport.start(initialOptions);
    await vi.waitFor(() => {
      expect(selectProtocolMessages(fixture.sentMessages)).toHaveLength(1);
    });
    const requestId = selectProtocolMessages(fixture.sentMessages)[0]?.d
      .request_id;
    if (!requestId) throw new Error("Native SelectProtocol has no request id");
    fixture.gateway.emit("session-description", {
      operation: "push",
      push_prefix: "screen",
      request_id: requestId,
      sdp: "native-answer",
      sdp_type: "answer",
      session_id: "native-session",
      tracks: [],
    });
    fixture.gateway.emit("negotiation-done", {
      operation: "push",
      push_prefix: "screen",
      request_id: requestId,
      session_id: "native-session",
    });

    await expect(startPromise).rejects.toBe(connectionError);
    expect(
      fixture.invoke.mock.calls.filter(
        ([command]) => command === "stop_native_screen_share",
      ),
    ).toHaveLength(1);
    expect(fixture.sentMessages).toEqual([
      expect.objectContaining({ op: GatewayOp.SelectProtocol }),
      {
        op: GatewayOp.StopTracks,
        d: {
          track_names: [
            "screen-video-local-participant",
            "screen-audio-local-participant",
          ],
        },
      },
    ]);
    expect(
      fixture.sentMessages.some(
        (message) => message.op === GatewayOp.TracksReady,
      ),
    ).toBe(false);
    expect(fixture.transport.active).toBe(false);

    await fixture.transport.stop();
    expect(
      fixture.invoke.mock.calls.filter(
        ([command]) => command === "stop_native_screen_share",
      ),
    ).toHaveLength(1);
    expect(
      fixture.sentMessages.filter(
        (message) => message.op === GatewayOp.StopTracks,
      ),
    ).toHaveLength(1);
  });

  it("waits for a deferred native start before stopping its capture", async () => {
    const fixture = createFixture();
    const nativeStart = createDeferred<unknown>();
    fixture.invoke.mockImplementation(async (command) => {
      if (command === "start_native_screen_share") {
        return nativeStart.promise;
      }
      return undefined;
    });

    const startPromise = fixture.transport.start(initialOptions);
    const startRejection = expect(startPromise).rejects.toThrow(
      "Native screen share operation was superseded",
    );
    await vi.waitFor(() => {
      expect(
        fixture.invoke.mock.calls.filter(
          ([command]) => command === "start_native_screen_share",
        ),
      ).toHaveLength(1);
    });

    const stopPromise = fixture.transport.stop();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      fixture.invoke.mock.calls.filter(
        ([command]) => command === "stop_native_screen_share",
      ),
    ).toHaveLength(0);

    nativeStart.resolve({ sdp: "stale-native-offer", type: "offer" });
    await Promise.all([startRejection, stopPromise]);

    expect(
      fixture.invoke.mock.calls.filter(
        ([command]) => command === "stop_native_screen_share",
      ),
    ).toHaveLength(1);
    expect(fixture.sentMessages).toEqual([]);
    expect(fixture.transport.active).toBe(false);
  });

  it("stops a deferred start before beginning its replacement", async () => {
    const fixture = createFixture();
    const firstNativeStart = createDeferred<unknown>();
    let nativeStartCount = 0;
    fixture.invoke.mockImplementation(async (command) => {
      if (command === "start_native_screen_share") {
        nativeStartCount += 1;
        if (nativeStartCount === 1) return firstNativeStart.promise;
        return { sdp: "replacement-native-offer", type: "offer" };
      }
      return undefined;
    });

    const firstStart = fixture.transport.start(initialOptions);
    const firstRejection = expect(firstStart).rejects.toThrow(
      "Native screen share operation was superseded",
    );
    await vi.waitFor(() => {
      expect(nativeStartCount).toBe(1);
    });

    const replacementStart = fixture.transport.start({
      ...initialOptions,
      sourceId: "window:replacement",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(nativeStartCount).toBe(1);
    expect(
      fixture.invoke.mock.calls.filter(
        ([command]) => command === "stop_native_screen_share",
      ),
    ).toHaveLength(0);

    firstNativeStart.resolve({ sdp: "stale-native-offer", type: "offer" });
    await completeStart(fixture, replacementStart, 0);
    await firstRejection;

    expect(nativeStartCount).toBe(2);
    expect(
      fixture.invoke.mock.calls
        .filter(
          ([command]) =>
            command === "start_native_screen_share" ||
            command === "stop_native_screen_share",
        )
        .map(([command]) => command),
    ).toEqual([
      "start_native_screen_share",
      "stop_native_screen_share",
      "start_native_screen_share",
    ]);
    expect(fixture.sentMessages.map((message) => message.op)).toEqual([
      GatewayOp.SelectProtocol,
      GatewayOp.TracksReady,
    ]);
    expect(fixture.transport.active).toBe(true);
  });

  it("replaces and stops the native source without exposing signaling to callers", async () => {
    const fixture = createFixture();
    await completeStart(fixture, fixture.transport.start(initialOptions), 0);

    fixture.sentMessages.length = 0;
    const replacement = fixture.transport.start({
      ...initialOptions,
      sourceId: "window:2",
      sourceName: "Replacement window",
      withAudio: false,
    });
    await completeStart(fixture, replacement, 0);
    await fixture.transport.stop();

    expect(
      fixture.invoke.mock.calls.filter(
        ([command]) => command === "stop_native_screen_share",
      ),
    ).toHaveLength(2);
    expect(fixture.sentMessages.map((message) => message.op)).toEqual([
      GatewayOp.StopTracks,
      GatewayOp.SelectProtocol,
      GatewayOp.TracksReady,
      GatewayOp.StopTracks,
    ]);
    expect(fixture.transport.active).toBe(false);
  });

  it("republishes on reconnect and rejects stale completion after reset", async () => {
    const fixture = createFixture();
    await completeStart(fixture, fixture.transport.start(initialOptions), 0);

    fixture.sentMessages.length = 0;
    await completeStart(fixture, fixture.transport.reconnect(), 0);
    expect(fixture.sentMessages.map((message) => message.op)).toEqual([
      GatewayOp.StopTracks,
      GatewayOp.SelectProtocol,
      GatewayOp.TracksReady,
    ]);

    fixture.sentMessages.length = 0;
    const pendingStart = fixture.transport.start({
      ...initialOptions,
      sourceId: "screen:reset",
    });
    await vi.waitFor(() => {
      expect(selectProtocolMessages(fixture.sentMessages)).toHaveLength(1);
    });
    const staleRequestId = selectProtocolMessages(fixture.sentMessages)[0]?.d
      .request_id;
    if (!staleRequestId) throw new Error("Pending start has no request id");
    await fixture.transport.reset();
    await expect(pendingStart).rejects.toThrow("Native screen share reset");

    fixture.gateway.emit("session-description", {
      operation: "push",
      push_prefix: "screen",
      request_id: staleRequestId,
      sdp: "stale-answer",
      sdp_type: "answer",
      session_id: "stale-session",
      tracks: [],
    });
    fixture.gateway.emit("negotiation-done", {
      operation: "push",
      push_prefix: "screen",
      request_id: staleRequestId,
      session_id: "stale-session",
    });
    await Promise.resolve();

    expect(
      fixture.sentMessages.some(
        (message) => message.op === GatewayOp.TracksReady,
      ),
    ).toBe(false);
    expect(fixture.transport.active).toBe(false);
  });

  it("disposes native capture and detaches its gateway handlers", async () => {
    const fixture = createFixture();
    await completeStart(fixture, fixture.transport.start(initialOptions), 0);
    fixture.sentMessages.length = 0;

    await fixture.transport.dispose();
    fixture.gateway.emit("session-description", {
      operation: "push",
      push_prefix: "screen",
      request_id: "disposed-request",
      sdp: "disposed-answer",
      sdp_type: "answer",
      session_id: "disposed-session",
      tracks: [],
    });
    fixture.gateway.emit("negotiation-done", {
      operation: "push",
      push_prefix: "screen",
      request_id: "disposed-request",
      session_id: "disposed-session",
    });

    expect(fixture.sentMessages).toEqual([
      {
        op: GatewayOp.StopTracks,
        d: {
          track_names: [
            "screen-video-local-participant",
            "screen-audio-local-participant",
          ],
        },
      },
    ]);
    await expect(fixture.transport.start(initialOptions)).rejects.toThrow(
      "Native screen share transport is disposed",
    );
  });
});
