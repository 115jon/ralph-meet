// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RefObject } from "react";

vi.mock("../SoundboardPicker", () => ({
  default: ({
    onSelect,
    markerRef,
  }: {
    onSelect: (sound: unknown) => void;
    markerRef?: RefObject<HTMLButtonElement | null>;
  }) => (
    <>
      <button
        ref={markerRef}
        type="button"
        data-testid="picker-anchor"
        aria-label="Mock select sound"
        onClick={() =>
          onSelect({
            id: "chime",
            name: "Chime",
            source: "default",
            volume: 1,
          })
        }
      >
        Select Chime
      </button>
      <output data-testid="picker-anchor-label">
        {markerRef?.current?.getAttribute("aria-label") ?? ""}
      </output>
    </>
  ),
}));

import { SettingsSoundboardTriggers } from "@/components/chat/SettingsSoundboardTriggers";
import { useSoundSettingsStore } from "@/stores/useSoundSettingsStore";

const servers = [
  {
    id: "server-1",
    name: "Alpha",
    owner_id: "user-1",
    icon_url: "/api/servers/server-1/icon",
    created_at: "2026-01-01T00:00:00.000Z",
  },
];

describe("SettingsSoundboardTriggers", () => {
  beforeEach(() => {
    useSoundSettingsStore.setState({
      currentUser: "user-1",
      userSettings: {},
      _cache: {},
    });
  });

  it("enables and selects a join sound without broadcasting", async () => {
    const user = userEvent.setup();
    render(<SettingsSoundboardTriggers userId="user-1" servers={servers} />);

    await user.click(screen.getByRole("button", { name: /toggle join/i }));
    await user.click(screen.getByRole("button", { name: /change join/i }));
    await user.click(screen.getByRole("button", { name: "Mock select sound" }));

    expect(
      useSoundSettingsStore.getState().getSettings("user-1")
        .voiceJoinSoundboard["*"],
    ).toEqual({
      enabled: true,
      sound: {
        source: "default",
        soundId: "chime",
        name: "Chime",
        volume: 1,
      },
    });
  });

  it("clears a selected leave sound", async () => {
    useSoundSettingsStore.setState({
      currentUser: "user-1",
      userSettings: {
        "user-1": {
          ...useSoundSettingsStore.getState().getSettings("user-1"),
          voiceLeaveSoundboard: {
            "*": {
              enabled: true,
              sound: {
                source: "default",
                soundId: "pop",
                name: "Pop",
                volume: 1,
              },
            },
          },
        },
      },
      _cache: {},
    });
    const user = userEvent.setup();
    render(<SettingsSoundboardTriggers userId="user-1" servers={servers} />);

    await user.click(screen.getByRole("button", { name: /clear leave/i }));

    expect(
      useSoundSettingsStore.getState().getSettings("user-1")
        .voiceLeaveSoundboard["*"],
    ).toEqual({ enabled: true, sound: null });
  });

  it("does not add a browser back state when opening the sound selector", async () => {
    const pushState = vi.spyOn(window.history, "pushState");
    const user = userEvent.setup();

    render(<SettingsSoundboardTriggers userId="user-1" servers={servers} />);
    await user.click(screen.getByRole("button", { name: /change join/i }));

    expect(pushState).not.toHaveBeenCalled();
    pushState.mockRestore();
  });

  it("switches to a server scope and shows the server icon and name", async () => {
    const user = userEvent.setup();
    render(<SettingsSoundboardTriggers userId="user-1" servers={servers} />);

    await user.click(
      screen.getByRole("button", { name: /soundboard server scope/i }),
    );
    expect(screen.getByRole("option", { name: "Alpha" })).toBeVisible();
    await user.click(screen.getByRole("option", { name: "Alpha" }));

    expect(
      screen.getByText("Alpha overrides inherit from All Servers."),
    ).toBeVisible();
    expect(
      screen
        .getAllByAltText("")
        .some(
          (image) => image.getAttribute("src") === "/api/servers/server-1/icon",
        ),
    ).toBe(true);
  });

  it("anchors the picker to the pencil that was clicked", async () => {
    const user = userEvent.setup();
    render(<SettingsSoundboardTriggers userId="user-1" servers={servers} />);

    await user.click(screen.getByRole("button", { name: /change join/i }));

    await waitFor(() =>
      expect(screen.getByTestId("picker-anchor-label")).toHaveTextContent(
        "Change Join sound",
      ),
    );
  });
});
