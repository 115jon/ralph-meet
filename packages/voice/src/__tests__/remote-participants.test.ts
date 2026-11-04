import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  REMOTE_RECONNECT_GRACE_MS,
  RemoteReconnectGrace,
} from "../remote-participants";
import { FakeTimers } from "./fake-timers";

describe("RemoteReconnectGrace", () => {
  let timers: FakeTimers;
  let expire: ReturnType<
    typeof vi.fn<
      (participantId: string, reoffered: ReadonlySet<string>) => void
    >
  >;
  let grace: RemoteReconnectGrace;

  beforeEach(() => {
    timers = new FakeTimers();
    expire = vi.fn();
    grace = new RemoteReconnectGrace({ timers, expire });
  });

  it("drops a participant who does not come back once the grace is over", () => {
    grace.disconnected("p1");
    timers.advance(REMOTE_RECONNECT_GRACE_MS - 1);
    expect(expire).not.toHaveBeenCalled();
    expect(grace.has("p1")).toBe(true);

    timers.advance(1);
    expect(expire).toHaveBeenCalledOnce();
    expect(expire).toHaveBeenCalledWith("p1", new Set());
    expect(grace.has("p1")).toBe(false);
  });

  it("keeps what a reconnecting participant offers again", () => {
    grace.disconnected("p1");
    timers.advance(800);
    expect(grace.offered("p1", "cam-audio-p1")).toBe(true);
    expect(expire).not.toHaveBeenCalled();

    timers.advance(REMOTE_RECONNECT_GRACE_MS);
    expect(expire).toHaveBeenCalledWith("p1", new Set(["cam-audio-p1"]));
  });

  it("ignores offers from participants outside a grace", () => {
    expect(grace.offered("p2", "cam-audio-p2")).toBe(false);
  });

  it("cancels the grace when the room says they left", () => {
    grace.disconnected("p1");
    expect(grace.left("p1")).toBe(true);
    timers.advance(REMOTE_RECONNECT_GRACE_MS);
    expect(expire).not.toHaveBeenCalled();
    expect(grace.left("p1")).toBe(false);
  });

  it("restarts the grace on a second disconnect", () => {
    grace.disconnected("p1");
    grace.offered("p1", "cam-audio-p1");
    timers.advance(2_000);
    grace.disconnected("p1");
    timers.advance(2_000);
    expect(expire).not.toHaveBeenCalled();
    timers.advance(1_000);
    // The second reconnect re-offered nothing yet.
    expect(expire).toHaveBeenCalledWith("p1", new Set());
  });

  it("tracks participants independently", () => {
    grace.disconnected("p1");
    timers.advance(1_000);
    grace.disconnected("p2");
    timers.advance(2_000);
    expect(expire).toHaveBeenCalledTimes(1);
    expect(expire).toHaveBeenLastCalledWith("p1", new Set());
    timers.advance(1_000);
    expect(expire).toHaveBeenLastCalledWith("p2", new Set());
  });

  it("cancels every grace without dropping anyone when disposed", () => {
    grace.disconnected("p1");
    grace.disconnected("p2");
    expect(grace.size).toBe(2);
    grace.dispose();
    expect(timers.size).toBe(0);
    timers.advance(REMOTE_RECONNECT_GRACE_MS);
    expect(expire).not.toHaveBeenCalled();
  });

  it("honours a custom grace length", () => {
    grace = new RemoteReconnectGrace({ timers, expire, graceMs: 50 });
    grace.disconnected("p1");
    timers.advance(50);
    expect(expire).toHaveBeenCalledOnce();
  });
});
