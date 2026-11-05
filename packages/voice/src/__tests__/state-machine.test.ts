import { describe, expect, it } from "vitest";
import {
  LEAVE_SEND_WINDOW_MS,
  isJoinedPhase,
  isLivePhase,
  nextPhase,
  planTeardown,
  type VoicePhase,
  type VoiceSessionEvent,
} from "../state-machine";

const PHASES: readonly VoicePhase[] = [
  "idle",
  "standby",
  "connecting",
  "joined",
  "reconnecting",
  "leaving",
];

const EVENTS: Record<string, VoiceSessionEvent> = {
  "hold-standby": { type: "hold-standby" },
  "release-standby": { type: "release-standby" },
  start: { type: "start" },
  joined: { type: "joined" },
  "connection-lost": { type: "connection-lost" },
  "connection-restored": { type: "connection-restored" },
  "end:user-leave": { type: "end", reason: "user-leave" },
  "end:component-unmount": { type: "end", reason: "component-unmount" },
  "end:forced-disconnect": { type: "end", reason: "forced-disconnect" },
  drained: { type: "drained" },
};

// The transition table of STATE_MACHINE.md, cell by cell. null: ignored.
const TABLE: Record<VoicePhase, Record<string, VoicePhase | null>> = {
  idle: {
    "hold-standby": "standby",
    "release-standby": null,
    start: "connecting",
    joined: null,
    "connection-lost": null,
    "connection-restored": null,
    "end:user-leave": null,
    "end:component-unmount": null,
    "end:forced-disconnect": null,
    drained: null,
  },
  standby: {
    "hold-standby": null,
    "release-standby": "idle",
    start: "connecting",
    joined: null,
    "connection-lost": null,
    "connection-restored": null,
    "end:user-leave": "idle",
    "end:component-unmount": "idle",
    "end:forced-disconnect": "leaving",
    drained: null,
  },
  connecting: {
    "hold-standby": null,
    "release-standby": null,
    start: null,
    joined: "joined",
    "connection-lost": null,
    "connection-restored": null,
    "end:user-leave": "leaving",
    "end:component-unmount": "leaving",
    "end:forced-disconnect": "leaving",
    drained: null,
  },
  joined: {
    "hold-standby": null,
    "release-standby": null,
    start: null,
    joined: "joined",
    "connection-lost": "reconnecting",
    "connection-restored": null,
    "end:user-leave": "leaving",
    "end:component-unmount": "leaving",
    "end:forced-disconnect": "leaving",
    drained: null,
  },
  reconnecting: {
    "hold-standby": null,
    "release-standby": null,
    start: null,
    joined: "joined",
    "connection-lost": "reconnecting",
    "connection-restored": "joined",
    "end:user-leave": "leaving",
    "end:component-unmount": "leaving",
    "end:forced-disconnect": "leaving",
    drained: null,
  },
  leaving: {
    "hold-standby": "standby",
    "release-standby": null,
    start: "connecting",
    joined: null,
    "connection-lost": null,
    "connection-restored": null,
    "end:user-leave": null,
    "end:component-unmount": null,
    "end:forced-disconnect": null,
    drained: "idle",
  },
};

describe("nextPhase", () => {
  for (const phase of PHASES) {
    for (const [name, event] of Object.entries(EVENTS)) {
      const expected = TABLE[phase][name];
      it(`${phase} + ${name} → ${expected ?? "ignored"}`, () => {
        expect(nextPhase(phase, event)).toBe(expected);
      });
    }
  }

  it("classifies live and joined phases", () => {
    expect(PHASES.filter(isLivePhase)).toEqual([
      "connecting",
      "joined",
      "reconnecting",
    ]);
    expect(PHASES.filter(isJoinedPhase)).toEqual(["joined", "reconnecting"]);
  });
});

describe("planTeardown", () => {
  const row = (plan: ReturnType<typeof planTeardown>) => [
    plan.leaveSound,
    plan.leaveTrigger,
    plan.sendWindowMs,
    plan.releaseClient,
    plan.notifyLeft,
    plan.clearPresence,
  ];
  const W = LEAVE_SEND_WINDOW_MS;

  it("keeps the leave send window at 100 ms", () => {
    expect(W).toBe(100);
  });

  it.each([
    // reason, joined, isCall, [sound, trigger, window, release, left, presence]
    [
      "user-leave",
      true,
      false,
      [true, true, W, "after-disconnect", true, true],
    ],
    [
      "user-leave",
      true,
      true,
      [false, true, W, "after-disconnect", false, true],
    ],
    ["user-leave", false, false, [false, false, 0, "now", false, false]],
    ["user-leave", false, true, [false, false, 0, "now", false, false]],
    [
      "forced-disconnect",
      true,
      false,
      [true, true, W, "after-disconnect", true, true],
    ],
    [
      "forced-disconnect",
      true,
      true,
      [false, true, W, "after-disconnect", true, true],
    ],
    [
      "forced-disconnect",
      false,
      false,
      [false, false, W, "after-disconnect", true, false],
    ],
    [
      "forced-disconnect",
      false,
      true,
      [false, false, W, "after-disconnect", true, false],
    ],
    ["component-unmount", true, false, [false, true, W, "now", false, true]],
    ["component-unmount", true, true, [false, true, W, "now", false, true]],
    ["component-unmount", false, false, [false, false, 0, "now", false, false]],
    ["component-unmount", false, true, [false, false, 0, "now", false, false]],
  ] as const)(
    "%s (joined: %s, call: %s)",
    (reason, joined, isCall, expected) => {
      const plan = planTeardown(reason, joined, { isCall });
      expect(plan.reason).toBe(reason);
      expect(plan.wasJoined).toBe(joined);
      expect(row(plan)).toEqual(expected);
    },
  );

  it.each([
    ["user-leave", true],
    ["forced-disconnect", true],
    ["forced-disconnect", false],
    ["component-unmount", true],
  ] as const)(
    "%s (joined: %s) without a leave trigger disconnects at once",
    (reason, joined) => {
      const withTrigger = planTeardown(reason, joined, { isCall: false });
      const plan = planTeardown(reason, joined, {
        isCall: false,
        leaveTrigger: false,
      });
      expect(plan).toEqual({
        ...withTrigger,
        leaveTrigger: false,
        sendWindowMs: 0,
      });
    },
  );
});
