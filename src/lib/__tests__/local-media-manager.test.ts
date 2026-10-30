import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireLocalStream,
  cancelPendingLocalStreamAcquisition,
  createLocalMediaOwner,
  releaseLocalStream,
  startEarlyMic,
  type LocalAudioConstraints,
} from "../local-media-manager";

const audioConstraints: LocalAudioConstraints = {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createAudioStream(deviceId: string) {
  const track = {
    getSettings: () => ({
      autoGainControl: true,
      deviceId,
      echoCancellation: true,
      noiseSuppression: true,
    }),
    kind: "audio",
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
    getVideoTracks: () => [],
  } as unknown as MediaStream;
  return { stream, track };
}

describe("local-media-manager", () => {
  afterEach(() => {
    releaseLocalStream();
    vi.unstubAllGlobals();
  });

  it("stops an early microphone stream that resolves after release", async () => {
    let resolveCapture: (stream: MediaStream) => void = () => {};
    const getUserMedia = vi.fn(
      () =>
        new Promise<MediaStream>((resolve) => {
          resolveCapture = resolve;
        }),
    );
    const track = { stop: vi.fn() } as unknown as MediaStreamTrack;
    const stream = {
      getTracks: () => [track],
    } as unknown as MediaStream;

    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia },
    });

    const pendingCapture = startEarlyMic(audioConstraints);
    await Promise.resolve();
    releaseLocalStream();
    resolveCapture(stream);

    await expect(pendingCapture).resolves.toBeNull();
    expect(track.stop).toHaveBeenCalledOnce();
  });

  it("does not start capture when a stored-device lookup resolves after release", async () => {
    let resolveDevices: (devices: MediaDeviceInfo[]) => void = () => {};
    const enumerateDevices = vi.fn(
      () =>
        new Promise<MediaDeviceInfo[]>((resolve) => {
          resolveDevices = resolve;
        }),
    );
    const getUserMedia = vi.fn();

    vi.stubGlobal("navigator", {
      mediaDevices: { enumerateDevices, getUserMedia },
    });

    const pendingCapture = acquireLocalStream(
      { ...audioConstraints, deviceId: "stored-device" },
      null,
    );
    await Promise.resolve();
    releaseLocalStream();
    resolveDevices([
      {
        deviceId: "stored-device",
        groupId: "group-1",
        label: "Microphone",
        kind: "audioinput",
      } as MediaDeviceInfo,
    ]);

    await expect(pendingCapture).rejects.toMatchObject({ name: "AbortError" });
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("keeps the newest direct acquisition when results resolve out of order", async () => {
    const enumerateDevices = vi.fn().mockResolvedValue([
      {
        deviceId: "device-a",
        groupId: "group-a",
        kind: "audioinput",
        label: "A",
      },
      {
        deviceId: "device-b",
        groupId: "group-b",
        kind: "audioinput",
        label: "B",
      },
    ] as MediaDeviceInfo[]);
    const firstCapture = deferred<MediaStream>();
    const secondCapture = deferred<MediaStream>();
    const first = createAudioStream("device-a");
    const second = createAudioStream("device-b");
    let captureCall = 0;
    const getUserMedia = vi.fn(() => {
      const call = captureCall++;
      return call === 0 ? firstCapture.promise : secondCapture.promise;
    });

    vi.stubGlobal("navigator", {
      mediaDevices: { enumerateDevices, getUserMedia },
    });

    const pendingFirst = acquireLocalStream(
      { ...audioConstraints, deviceId: "device-a" },
      null,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    const pendingSecond = acquireLocalStream(
      { ...audioConstraints, deviceId: "device-b" },
      null,
    );

    secondCapture.resolve(second.stream);
    await expect(pendingSecond).resolves.toBe(second.stream);

    firstCapture.resolve(first.stream);
    await expect(pendingFirst).rejects.toMatchObject({ name: "AbortError" });

    expect(first.track.stop).toHaveBeenCalledOnce();
    expect(second.track.stop).not.toHaveBeenCalled();
    await expect(
      acquireLocalStream({ ...audioConstraints, deviceId: "device-b" }, null),
    ).resolves.toBe(second.stream);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("lets an early shared capture supersede an older direct request", async () => {
    const storedDevices = deferred<MediaDeviceInfo[]>();
    const earlyCapture = deferred<MediaStream>();
    const early = createAudioStream("early-device");
    const enumerateDevices = vi.fn(() => storedDevices.promise);
    const getUserMedia = vi.fn(() => earlyCapture.promise);

    vi.stubGlobal("navigator", {
      mediaDevices: { enumerateDevices, getUserMedia },
    });

    const directRequest = acquireLocalStream(
      { ...audioConstraints, deviceId: "stored-device" },
      null,
    );
    const earlyRequest = startEarlyMic(audioConstraints);
    const sharedCaller = acquireLocalStream(audioConstraints, null);

    earlyCapture.resolve(early.stream);
    await expect(earlyRequest).resolves.toBe(early.stream);
    await expect(sharedCaller).resolves.toBe(early.stream);

    storedDevices.resolve([
      {
        deviceId: "stored-device",
        groupId: "group-stored",
        kind: "audioinput",
        label: "Stored",
      } as MediaDeviceInfo,
    ]);
    await expect(directRequest).rejects.toMatchObject({ name: "AbortError" });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(early.track.stop).not.toHaveBeenCalled();
  });

  it("revalidates an early shared stream for an explicit device request", async () => {
    const earlyCapture = deferred<MediaStream>();
    const requestedCapture = deferred<MediaStream>();
    const early = createAudioStream("device-a");
    const requested = createAudioStream("device-b");
    let captureCall = 0;
    const getUserMedia = vi.fn(() =>
      captureCall++ === 0 ? earlyCapture.promise : requestedCapture.promise,
    );
    const enumerateDevices = vi.fn().mockResolvedValue([
      { deviceId: "device-a", groupId: "a", kind: "audioinput", label: "A" },
      { deviceId: "device-b", groupId: "b", kind: "audioinput", label: "B" },
    ] as MediaDeviceInfo[]);

    vi.stubGlobal("navigator", {
      mediaDevices: { enumerateDevices, getUserMedia },
    });

    const earlyRequest = startEarlyMic({
      ...audioConstraints,
      deviceId: "device-a",
    });
    const explicitRequest = acquireLocalStream(
      { ...audioConstraints, deviceId: "device-b" },
      null,
    );
    earlyCapture.resolve(early.stream);
    await expect(earlyRequest).resolves.toBe(early.stream);
    await Promise.resolve();
    expect(getUserMedia).toHaveBeenCalledTimes(2);

    requestedCapture.resolve(requested.stream);
    await expect(explicitRequest).resolves.toBe(requested.stream);
  });

  it("stops an early audio stream when the first request adds video", async () => {
    const early = createAudioStream("device-a");
    const replacement = createAudioStream("device-a");
    const videoTrack = {
      getSettings: () => ({ deviceId: "camera-a" }),
      kind: "video",
      stop: vi.fn(),
    } as unknown as MediaStreamTrack;
    const combined = {
      getAudioTracks: () => replacement.stream.getAudioTracks(),
      getTracks: () => [...replacement.stream.getAudioTracks(), videoTrack],
      getVideoTracks: () => [videoTrack],
    } as unknown as MediaStream;
    const requestedCapture = deferred<MediaStream>();
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(early.stream)
      .mockReturnValueOnce(requestedCapture.promise);
    const enumerateDevices = vi.fn().mockResolvedValue([]);

    vi.stubGlobal("navigator", {
      mediaDevices: { enumerateDevices, getUserMedia },
    });

    const earlyRequest = startEarlyMic(audioConstraints);
    const explicitRequest = acquireLocalStream(audioConstraints, {
      deviceId: "camera-a",
      qualityId: "720p30",
    });
    await expect(earlyRequest).resolves.toBe(early.stream);
    requestedCapture.resolve(combined);
    await expect(explicitRequest).resolves.toBe(combined);
    expect(early.track.stop).toHaveBeenCalledOnce();
  });

  it("does not reuse an ended microphone", async () => {
    const ended = createAudioStream("mic");
    (ended.track as { readyState: MediaStreamTrackState }).readyState = "ended";
    const replacement = createAudioStream("mic");
    (replacement.track as { readyState: MediaStreamTrackState }).readyState =
      "live";
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(ended.stream)
      .mockResolvedValueOnce(replacement.stream);

    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia },
    });

    await expect(acquireLocalStream(audioConstraints, null)).resolves.toBe(
      ended.stream,
    );
    await expect(acquireLocalStream(audioConstraints, null)).resolves.toBe(
      replacement.stream,
    );

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(ended.track.stop).toHaveBeenCalledOnce();
  });

  it("reuses an early stream after resolving a stale stored device ID", async () => {
    const early = createAudioStream("current-device");
    const enumerateDevices = vi.fn().mockResolvedValue([
      {
        deviceId: "current-device",
        groupId: "current-group",
        kind: "audioinput",
        label: "Focusrite Input",
      },
    ] as MediaDeviceInfo[]);
    const getUserMedia = vi.fn().mockResolvedValue(early.stream);
    const staleConstraints = {
      ...audioConstraints,
      deviceId: "stale-device",
      deviceLabel: "Focusrite Input",
      groupId: "stale-group",
    };

    vi.stubGlobal("navigator", {
      mediaDevices: { enumerateDevices, getUserMedia },
    });

    await expect(startEarlyMic(staleConstraints)).resolves.toBe(early.stream);
    await expect(acquireLocalStream(staleConstraints, null)).resolves.toBe(
      early.stream,
    );

    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(early.track.stop).not.toHaveBeenCalled();
  });

  it("cancels an active-stream lookup while stale device resolution is pending", async () => {
    const active = createAudioStream("current-device");
    const devices = deferred<MediaDeviceInfo[]>();
    const enumerateDevices = vi.fn(() => devices.promise);
    const getUserMedia = vi.fn().mockResolvedValue(active.stream);

    vi.stubGlobal("navigator", {
      mediaDevices: { enumerateDevices, getUserMedia },
    });

    await expect(acquireLocalStream(audioConstraints, null)).resolves.toBe(
      active.stream,
    );
    const pendingLookup = acquireLocalStream(
      {
        ...audioConstraints,
        deviceId: "stale-device",
        deviceLabel: "Focusrite Input",
      },
      null,
    );
    await vi.waitFor(() => expect(enumerateDevices).toHaveBeenCalledTimes(2));
    cancelPendingLocalStreamAcquisition();
    devices.resolve([
      {
        deviceId: "current-device",
        groupId: "current-group",
        kind: "audioinput",
        label: "Focusrite Input",
      } as MediaDeviceInfo,
    ]);

    await expect(pendingLookup).rejects.toMatchObject({ name: "AbortError" });
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it("reacquires the system default when a stale device cannot be resolved", async () => {
    const active = createAudioStream("previous-device");
    const replacement = createAudioStream("current-default");
    const enumerateDevices = vi.fn().mockResolvedValue([]);
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce(active.stream)
      .mockResolvedValueOnce(replacement.stream);

    vi.stubGlobal("navigator", {
      mediaDevices: { enumerateDevices, getUserMedia },
    });

    await expect(acquireLocalStream(audioConstraints, null)).resolves.toBe(
      active.stream,
    );
    await expect(
      acquireLocalStream(
        {
          ...audioConstraints,
          deviceId: "missing-device",
          deviceLabel: "Missing Input",
        },
        null,
      ),
    ).resolves.toBe(replacement.stream);
    await expect(
      acquireLocalStream(
        {
          ...audioConstraints,
          deviceId: "missing-device",
          deviceLabel: "Missing Input",
        },
        null,
      ),
    ).resolves.toBe(replacement.stream);

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(active.track.stop).not.toHaveBeenCalled();
  });

  it("cancels a pending direct acquisition without clearing the active cache", async () => {
    const active = createAudioStream("active-device");
    const stale = createAudioStream("stale-device");
    const pendingCapture = deferred<MediaStream>();
    let captureCall = 0;
    const getUserMedia = vi.fn(() => {
      captureCall += 1;
      return captureCall === 1
        ? Promise.resolve(active.stream)
        : pendingCapture.promise;
    });

    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    await expect(acquireLocalStream(audioConstraints, null)).resolves.toBe(
      active.stream,
    );
    const pendingRequest = acquireLocalStream(
      { ...audioConstraints, noiseSuppression: false },
      null,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(getUserMedia).toHaveBeenCalledTimes(2);

    cancelPendingLocalStreamAcquisition();
    pendingCapture.resolve(stale.stream);

    await expect(pendingRequest).rejects.toMatchObject({ name: "AbortError" });
    expect(stale.track.stop).toHaveBeenCalledOnce();
    expect(active.track.stop).not.toHaveBeenCalled();
    await expect(acquireLocalStream(audioConstraints, null)).resolves.toBe(
      active.stream,
    );
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it("isolates pending acquisition and release between owners", async () => {
    const ownerA = createLocalMediaOwner();
    const ownerB = createLocalMediaOwner();
    const captureA = deferred<MediaStream>();
    const captureB = deferred<MediaStream>();
    const streamA = createAudioStream("owner-a");
    const streamB = createAudioStream("owner-b");
    let captureCall = 0;
    const getUserMedia = vi.fn(() => {
      captureCall += 1;
      return captureCall === 1 ? captureA.promise : captureB.promise;
    });

    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });

    const pendingA = acquireLocalStream(
      { ...audioConstraints, noiseSuppression: false },
      null,
      "OwnerA",
      ownerA,
    );
    await Promise.resolve();
    await Promise.resolve();
    const pendingB = acquireLocalStream(
      audioConstraints,
      null,
      "OwnerB",
      ownerB,
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(getUserMedia).toHaveBeenCalledTimes(2);

    cancelPendingLocalStreamAcquisition(ownerA);
    releaseLocalStream(ownerA);
    captureB.resolve(streamB.stream);
    await expect(pendingB).resolves.toBe(streamB.stream);

    captureA.resolve(streamA.stream);
    await expect(pendingA).rejects.toMatchObject({ name: "AbortError" });
    expect(streamA.track.stop).toHaveBeenCalledOnce();
    expect(streamB.track.stop).not.toHaveBeenCalled();
    await expect(
      acquireLocalStream(audioConstraints, null, "OwnerB-reuse", ownerB),
    ).resolves.toBe(streamB.stream);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });
});
