/**
 * @vitest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActiveSoundboardEffectList } from "../ActiveSoundboardEffectList";
import {
  useVoiceSoundboardStore,
  type VoiceSoundboardStore,
} from "@/stores/useVoiceSoundboardStore";
import type { SFUClient } from "@/lib/sfu-client";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/stores/useVoiceSoundboardStore");
vi.mock("@/hooks/useUserResolution", () => ({
  useUserResolution: (userId: string) => ({
    displayName: userId === "user-1" ? "Alice" : "Bob",
    avatarUrl: null,
    avatarDisplay: null,
  }),
}));

describe("ActiveSoundboardEffectList", () => {
  let mockSfu: SFUClient;

  const makeStore = (
    activePlaybacks: VoiceSoundboardStore["activePlaybacks"],
  ): VoiceSoundboardStore => ({
    activePlaybacks,
    serverMutedByServer: {},
    upsertPlayback: vi.fn(),
    removePlayback: vi.fn(),
    clearServerPlaybacks: vi.fn(),
    setPlaybackPaused: vi.fn(),
    setPlaybackVolume: vi.fn(),
    setServerSoundboardMuted: vi.fn(),
  });

  beforeEach(() => {
    mockSfu = {
      voiceGW: {
        sendAppEvent: vi.fn(),
      },
    } as unknown as SFUClient;
  });

  it("renders nothing when no active playbacks exist", () => {
    vi.mocked(useVoiceSoundboardStore).mockImplementation((selector) =>
      selector(makeStore({})),
    );

    const { container } = render(
      <ActiveSoundboardEffectList
        serverKey="server-1"
        localUserId="user-1"
        sfu={mockSfu}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("renders active effects for the scoped server", () => {
    const activePlaybacks = {
      "effect-1": {
        playbackId: "effect-1",
        ownerId: "user-1",
        serverKey: "server-1",
        name: "Airhorn",
        isLocal: true,
        startedAt: Date.now(),
        paused: false,
        volume: 1.0,
      },
      "effect-2": {
        playbackId: "effect-2",
        ownerId: "user-2",
        serverKey: "server-1",
        name: "Drumroll",
        isLocal: false,
        startedAt: Date.now() - 1000,
        paused: false,
        volume: 0.8,
      },
      "effect-3": {
        playbackId: "effect-3",
        ownerId: "user-1",
        serverKey: "other-server",
        name: "Should Not Show",
        isLocal: true,
        startedAt: Date.now(),
        paused: false,
        volume: 1.0,
      },
    };

    vi.mocked(useVoiceSoundboardStore).mockImplementation((selector) =>
      selector(makeStore(activePlaybacks)),
    );

    render(
      <ActiveSoundboardEffectList
        serverKey="server-1"
        localUserId="user-1"
        sfu={mockSfu}
        variant="compact"
      />,
    );

    expect(screen.getByText("Airhorn")).toBeInTheDocument();
    expect(screen.queryByText("Drumroll")).not.toBeInTheDocument();
    expect(screen.queryByText("Should Not Show")).not.toBeInTheDocument();
  });

  it("allows local owner to pause/resume their effects", async () => {
    const user = userEvent.setup();

    const activePlaybacks = {
      "effect-1": {
        playbackId: "effect-1",
        ownerId: "user-1",
        serverKey: "server-1",
        name: "Airhorn",
        isLocal: true,
        startedAt: Date.now(),
        paused: false,
        volume: 1.0,
      },
    };

    vi.mocked(useVoiceSoundboardStore).mockImplementation((selector) =>
      selector(makeStore(activePlaybacks)),
    );

    render(
      <ActiveSoundboardEffectList
        serverKey="server-1"
        localUserId="user-1"
        sfu={mockSfu}
      />,
    );

    const pauseButton = screen.getByRole("button", { name: /pause/i });
    await user.click(pauseButton);

    expect(mockSfu.voiceGW.sendAppEvent).toHaveBeenCalledWith({
      type: "soundboard.pause-set",
      server_key: "server-1",
      user_id: "user-1",
      playback_id: "effect-1",
      paused: true,
    });
  });

  it("does not render effects owned by another user", () => {
    const activePlaybacks = {
      "effect-2": {
        playbackId: "effect-2",
        ownerId: "user-2",
        serverKey: "server-1",
        name: "Drumroll",
        isLocal: false,
        startedAt: Date.now(),
        paused: false,
        volume: 0.8,
      },
    };

    vi.mocked(useVoiceSoundboardStore).mockImplementation((selector) =>
      selector(makeStore(activePlaybacks)),
    );

    render(
      <ActiveSoundboardEffectList
        serverKey="server-1"
        localUserId="user-1"
        sfu={mockSfu}
      />,
    );

    expect(screen.queryByText("Drumroll")).not.toBeInTheDocument();
    expect(mockSfu.voiceGW.sendAppEvent).not.toHaveBeenCalled();
  });

  it("pauses a local preview without sending an app event", async () => {
    const user = userEvent.setup();
    vi.mocked(useVoiceSoundboardStore).mockImplementation((selector) =>
      selector(
        makeStore({
          "local-preview": {
            playbackId: "local-preview",
            ownerId: "user-1",
            serverKey: "server-1",
            name: "Preview: Airhorn",
            isLocal: true,
            startedAt: Date.now(),
            paused: false,
            volume: 1,
          },
        }),
      ),
    );

    render(
      <ActiveSoundboardEffectList
        serverKey="server-1"
        localUserId="user-1"
        sfu={mockSfu}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Pause" }));

    expect(mockSfu.voiceGW.sendAppEvent).not.toHaveBeenCalled();
  });

  it("stops a local preview without sending an app event", async () => {
    const user = userEvent.setup();
    vi.mocked(useVoiceSoundboardStore).mockImplementation((selector) =>
      selector(
        makeStore({
          "local-preview": {
            playbackId: "local-preview",
            ownerId: "user-1",
            serverKey: "server-1",
            name: "Preview: Airhorn",
            isLocal: true,
            startedAt: Date.now(),
            paused: false,
            volume: 1,
          },
        }),
      ),
    );

    render(
      <ActiveSoundboardEffectList
        serverKey="server-1"
        localUserId="user-1"
        sfu={mockSfu}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Stop" }));

    expect(mockSfu.voiceGW.sendAppEvent).not.toHaveBeenCalled();
  });

  it("shows no UI for an empty compact list", () => {
    vi.mocked(useVoiceSoundboardStore).mockImplementation((selector) =>
      selector(makeStore({})),
    );

    const { container } = render(
      <ActiveSoundboardEffectList
        serverKey="server-1"
        localUserId="user-1"
        sfu={mockSfu}
        variant="compact"
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("uses the dm-call key for DMs", () => {
    const activePlaybacks = {
      "effect-1": {
        playbackId: "effect-1",
        ownerId: "user-1",
        serverKey: "dm-call",
        name: "DM Sound",
        isLocal: true,
        startedAt: Date.now(),
        paused: false,
        volume: 1.0,
      },
    };

    vi.mocked(useVoiceSoundboardStore).mockImplementation((selector) =>
      selector(makeStore(activePlaybacks)),
    );

    render(
      <ActiveSoundboardEffectList
        serverId={null}
        localUserId="user-1"
        sfu={mockSfu}
      />,
    );

    expect(screen.getByText("DM Sound")).toBeInTheDocument();
  });
});
