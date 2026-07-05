import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  applyRtcRoomControlIdentifyEffects,
  applyRtcRoomControlResumeEffects,
  applyRtcRoomProfileRefreshEffects,
  applyRtcRoomRefreshVoiceCredentialsEffects,
  applyRtcRoomVoiceStateUpdateEffects,
  type RtcRoomControlSessionEffectsAdapter,
  type RtcRoomControlSessionEffectsSession,
} from "./rtc-room-control-session-effects";

type SessionEffectsModule = Record<string, unknown>;

const EXPECTED_EFFECT_EXPORTS = {
  identify: [
    "applyRtcRoomControlIdentifyEffect",
    "applyRtcRoomControlIdentifySessionEffect",
    "applyRtcRoomControlIdentify",
  ],
  resume: [
    "applyRtcRoomControlResumeEffect",
    "applyRtcRoomControlResumeSessionEffect",
    "applyRtcRoomControlResume",
  ],
  refreshVoiceCredentials: [
    "applyRtcRoomControlRefreshVoiceCredentialsEffect",
    "applyRtcRoomControlRefreshVoiceCredentialsSessionEffect",
    "applyRtcRoomRefreshVoiceCredentialsEffect",
    "applyRtcRoomRefreshVoiceCredentials",
  ],
  voiceStateUpdate: [
    "applyRtcRoomControlVoiceStateUpdateEffect",
    "applyRtcRoomControlVoiceStateUpdateSessionEffect",
    "applyRtcRoomVoiceStateUpdateEffect",
    "applyRtcRoomVoiceStateUpdate",
  ],
  profileRefresh: [
    "applyRtcRoomControlProfileRefreshEffect",
    "applyRtcRoomControlProfileRefreshSessionEffect",
    "applyRtcRoomProfileRefreshEffect",
    "applyRtcRoomProfileRefresh",
  ],
} as const;

const EXPECTED_EFFECT_CASES = Object.entries(EXPECTED_EFFECT_EXPORTS) as Array<
  [keyof typeof EXPECTED_EFFECT_EXPORTS, readonly string[]]
>;

const sessionEffectsModuleLoaders = import.meta.glob("./rtc-room-control-session-effects.ts");
const loadSessionEffectsModule = sessionEffectsModuleLoaders["./rtc-room-control-session-effects.ts"] as
  | (() => Promise<SessionEffectsModule>)
  | undefined;

function resolveNamedExport(
  moduleExports: SessionEffectsModule,
  candidateNames: readonly string[],
) {
  for (const candidateName of candidateNames) {
    const exportedValue = moduleExports[candidateName];
    if (typeof exportedValue === "function") {
      return { candidateName, exportedValue };
    }
  }

  return null;
}

describe("rtc-room-control-session-effects planned contract", () => {
  it("tracks the expected helper families for the upcoming extraction", () => {
    expect(EXPECTED_EFFECT_CASES.map(([effectName]) => effectName)).toEqual([
      "identify",
      "resume",
      "refreshVoiceCredentials",
      "voiceStateUpdate",
      "profileRefresh",
    ]);
    expect(EXPECTED_EFFECT_EXPORTS.identify[0]).toBe("applyRtcRoomControlIdentifyEffect");
    expect(EXPECTED_EFFECT_EXPORTS.resume[0]).toBe("applyRtcRoomControlResumeEffect");
    expect(EXPECTED_EFFECT_EXPORTS.refreshVoiceCredentials[0]).toBe(
      "applyRtcRoomControlRefreshVoiceCredentialsEffect",
    );
    expect(EXPECTED_EFFECT_EXPORTS.voiceStateUpdate[0]).toBe(
      "applyRtcRoomControlVoiceStateUpdateEffect",
    );
    expect(EXPECTED_EFFECT_EXPORTS.profileRefresh[0]).toBe(
      "applyRtcRoomControlProfileRefreshEffect",
    );
  });

  it.todo(
    "Identify persists and rehydrates the next control attachment before applying the meeting-room identify effect",
  );
  it.todo(
    "Resume clears resumable expiry state, restores the control attachment, refreshes voice credentials, and syncs the pending batch",
  );
  it.todo(
    "RefreshVoiceCredentials rehydrates the committed control session before applying refreshed credentials without a storage batch sync",
  );
  it.todo(
    "ProfileRefresh respects the cooldown gate, persists verified profile fields, and syncs the pending batch only when new profile data resolves",
  );
});

const describeConcreteSessionEffects = loadSessionEffectsModule ? describe : describe.skip;

describeConcreteSessionEffects("rtc-room-control-session-effects exports", () => {
  let sessionEffectsModule: SessionEffectsModule;

  beforeAll(async () => {
    sessionEffectsModule = await loadSessionEffectsModule!();
  });

  it.each(EXPECTED_EFFECT_CASES)(
    "exposes an adapter-driven %s helper",
    (effectName, candidateNames) => {
      const resolvedExport = resolveNamedExport(sessionEffectsModule, candidateNames);

      expect(
        resolvedExport?.candidateName,
        `No ${effectName} helper matched any of: ${candidateNames.join(", ")}`,
      ).toBeTruthy();
      expect(typeof resolvedExport?.exportedValue).toBe("function");
    },
  );
});

type TestParticipant = { id: string };

type TestSession = RtcRoomControlSessionEffectsSession & {
  status: "online" | "idle" | "dnd" | "offline";
};

const makeSession = (overrides: Partial<TestSession> = {}): TestSession => ({
  id: "participant-1",
  name: "Alice",
  clerk_user_id: "user-1",
  self_mute: false,
  self_deaf: false,
  self_stream: false,
  self_stream_audio: false,
  self_video: false,
  suppress: false,
  status: "online",
  tracks: [],
  subscribed_channels: [],
  subscribed_servers: [],
  ...overrides,
});

function createSessionEffectsAdapter(
  overrides: Partial<RtcRoomControlSessionEffectsAdapter<TestSession, TestParticipant>> = {},
) {
  return {
    restoreSubscriptions: vi.fn(),
    restoreVoiceMembershipOnResume: vi.fn(async () => undefined),
    buildControlParticipants: vi.fn(() => [{ id: "participant-2" }]),
    buildVoiceState: vi.fn((session: TestSession) => ({
      id: session.id,
      voice_channel_id: session.voice_channel_id,
    })),
    getSpatialAudioState: vi.fn((scopeId: string) => ({ scopeId })),
    sendTo: vi.fn(),
    broadcast: vi.fn(),
    sendVoiceChannelStates: vi.fn(async () => undefined),
    queueBroadcastVoiceChannelState: vi.fn(),
    updateSpatialAudioState: vi.fn((_scopeId: string, spatialAudioState: unknown) => spatialAudioState),
    syncVoiceStateProjection: vi.fn(),
    refreshVoiceProjectionIdentity: vi.fn(),
    applyProfileVoiceProjectionUpdate: vi.fn(),
    logInfo: vi.fn(),
    ...overrides,
  } satisfies RtcRoomControlSessionEffectsAdapter<TestSession, TestParticipant>;
}

describe("rtc-room-control-session-effects behavior", () => {
  it("identifies through the adapter, including pending-call reconnect fanout", () => {
    const ws = {} as WebSocket;
    const session = makeSession({
      status: "idle",
      voice_channel_id: "vc-1",
    });
    const adapter = createSessionEffectsAdapter();

    const applied = applyRtcRoomControlIdentifyEffects(
      adapter,
      ws,
      session,
      {
        iceServers: [{ urls: "stun:stun.example.com" }],
        voiceToken: "voice-token",
      } as any,
      "room-1",
      {
        pendingIncomingCall: {
          callId: "call-1",
          callerId: "caller-1",
          callerName: "Bob",
          channelId: "dm-1",
          calleeId: "user-1",
        },
      },
    );

    expect(applied).toBe(true);
    expect(adapter.refreshVoiceProjectionIdentity).toHaveBeenCalledWith(session, ws);
    expect(adapter.buildControlParticipants).toHaveBeenCalledWith("participant-1");
    expect(adapter.getSpatialAudioState).toHaveBeenCalledWith("vc-1");
    expect(adapter.sendTo).toHaveBeenNthCalledWith(
      1,
      ws,
      expect.objectContaining({
        op: 2,
        d: expect.objectContaining({
          participant_id: "participant-1",
          voice_token: "voice-token",
          spatial_audio_state: { scopeId: "vc-1" },
        }),
      }),
    );
    expect(adapter.sendVoiceChannelStates).toHaveBeenCalledWith(ws, session);
    expect(adapter.queueBroadcastVoiceChannelState).toHaveBeenCalledWith("vc-1");
    expect(adapter.broadcast).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        op: 15,
        d: {
          participant: { id: "participant-1", voice_channel_id: "vc-1" },
          action: "join",
        },
      }),
      ws,
    );
    expect(adapter.broadcast).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        op: 19,
        d: {
          event: "PRESENCE_UPDATE",
          data: { user_id: "user-1", status: "idle" },
        },
      }),
      ws,
    );
    expect(adapter.sendTo).toHaveBeenNthCalledWith(
      2,
      ws,
      expect.objectContaining({
        op: 19,
        d: expect.objectContaining({
          event: "CALL_RING",
          data: expect.objectContaining({
            call_id: "call-1",
            caller_id: "caller-1",
            channel_id: "dm-1",
            is_reconnect: true,
          }),
        }),
      }),
    );
    expect(adapter.logInfo).toHaveBeenCalledWith(
      "Found pending call (as callee) for user-1: callId=call-1",
    );
  });

  it("resumes through the adapter before sending the authoritative snapshot", async () => {
    const ws = {} as WebSocket;
    const session = makeSession({
      clerk_user_id: "user-1",
      voice_channel_id: undefined,
    });
    const order: string[] = [];
    const adapter = createSessionEffectsAdapter({
      restoreSubscriptions: vi.fn(() => {
        order.push("restore-subscriptions");
      }),
      restoreVoiceMembershipOnResume: vi.fn(async () => {
        order.push("restore-voice-membership");
      }),
      buildControlParticipants: vi.fn(() => {
        order.push("build-participants");
        return [{ id: "participant-2" }];
      }),
      getSpatialAudioState: vi.fn((scopeId: string) => {
        order.push(`get-spatial:${scopeId}`);
        return { scopeId };
      }),
      sendTo: vi.fn(() => {
        order.push("send-resumed");
      }),
      sendVoiceChannelStates: vi.fn(async () => {
        order.push("send-voice-states");
      }),
      logInfo: vi.fn(() => {
        order.push("log");
      }),
    });

    const applied = await applyRtcRoomControlResumeEffects(
      adapter,
      ws,
      session,
      {
        iceServers: [{ urls: "turn:turn.example.com" }],
        voiceToken: "voice-token",
      } as any,
      "room-1",
    );

    expect(applied).toBe(true);
    expect(order).toEqual([
      "restore-subscriptions",
      "restore-voice-membership",
      "log",
      "build-participants",
      "get-spatial:room-1",
      "send-resumed",
      "send-voice-states",
    ]);
    expect(adapter.sendTo).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        op: 9,
        d: expect.objectContaining({
          voice_token: "voice-token",
          spatial_audio_state: { scopeId: "room-1" },
        }),
      }),
    );
    expect(adapter.sendVoiceChannelStates).toHaveBeenCalledWith(ws, session);
  });

  it("refreshes voice credentials without re-sending spatial audio state", () => {
    const ws = {} as WebSocket;
    const session = makeSession({
      voice_channel_id: "vc-1",
    });
    const sendTo = vi.fn();
    const getSpatialAudioState = vi.fn();
    const sendVoiceChannelStates = vi.fn();
    const adapter = createSessionEffectsAdapter({
      sendTo,
      getSpatialAudioState,
      sendVoiceChannelStates,
    });

    const applied = applyRtcRoomRefreshVoiceCredentialsEffects(
      adapter,
      ws,
      session,
      {
        iceServers: [{ urls: "stun:stun.example.com" }],
        voiceToken: "voice-token",
      } as any,
      "room-1",
    );

    expect(applied).toBe(true);
    expect(sendTo).toHaveBeenCalledWith(
      ws,
      expect.objectContaining({
        op: 9,
        d: expect.objectContaining({
          voice_token: "voice-token",
        }),
      }),
    );
    expect(sendTo.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        d: expect.not.objectContaining({
          spatial_audio_state: expect.anything(),
        }),
      }),
    );
    expect(getSpatialAudioState).not.toHaveBeenCalled();
    expect(sendVoiceChannelStates).not.toHaveBeenCalled();
  });

  it("broadcasts voice-state updates through the adapter and syncs projection state", () => {
    const ws = {} as WebSocket;
    const session = makeSession({
      voice_channel_id: "vc-1",
      self_mute: true,
    });
    const adapter = createSessionEffectsAdapter({
      buildVoiceState: vi.fn(() => ({ id: "participant-1", self_mute: true })),
      updateSpatialAudioState: vi.fn((_scopeId, spatialAudioState) => ({
        ...(spatialAudioState as Record<string, unknown>),
        updated: true,
      })),
    });

    const applied = applyRtcRoomVoiceStateUpdateEffects(
      adapter,
      ws,
      session,
      "room-1",
      { positions: [] },
    );

    expect(applied).toBe(true);
    expect(adapter.updateSpatialAudioState).toHaveBeenCalledWith("vc-1", { positions: [] }, session);
    expect(adapter.broadcast).toHaveBeenCalledWith(
      {
        op: 15,
        d: {
          participant: { id: "participant-1", self_mute: true },
          action: "update",
          spatial_audio_state: { positions: [], updated: true },
        },
      },
      ws,
    );
    expect(adapter.syncVoiceStateProjection).toHaveBeenCalledWith(session);
  });

  it("broadcasts refreshed profile fields and updates voice projection when the user is in voice", () => {
    const ws = {} as WebSocket;
    const session = makeSession({
      voice_channel_id: "vc-1",
    });
    const adapter = createSessionEffectsAdapter();
    const verified = {
      name: "Alice Updated",
      username: "alice",
      displayName: "Alice Updated",
      avatarUrl: "/avatar.png",
      avatarDisplay: "cover",
    };

    const applied = applyRtcRoomProfileRefreshEffects(adapter, ws, session, verified as any);

    expect(applied).toBe(true);
    expect(adapter.broadcast).toHaveBeenCalledWith(
      {
        op: 16,
        d: {
          participant_id: "participant-1",
          name: "Alice Updated",
          username: "alice",
          display_name: "Alice Updated",
          avatar_url: "/avatar.png",
          avatar_display: "cover",
        },
      },
      ws,
    );
    expect(adapter.applyProfileVoiceProjectionUpdate).toHaveBeenCalledWith(session, verified);
  });

  it("skips voice projection updates when profile refresh has no active voice membership", () => {
    const ws = {} as WebSocket;
    const session = makeSession({
      clerk_user_id: undefined,
      voice_channel_id: undefined,
    });
    const adapter = createSessionEffectsAdapter();

    const applied = applyRtcRoomProfileRefreshEffects(
      adapter,
      ws,
      session,
      {
        name: "Alice Updated",
        username: "alice",
        displayName: "Alice Updated",
        avatarUrl: "/avatar.png",
        avatarDisplay: "cover",
      } as any,
    );

    expect(applied).toBe(true);
    expect(adapter.applyProfileVoiceProjectionUpdate).not.toHaveBeenCalled();
  });
});
