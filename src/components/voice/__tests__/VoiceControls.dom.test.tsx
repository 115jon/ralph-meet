// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

const mocks = vi.hoisted(() => ({
  isMobile: true,
  sheet: vi.fn(),
}));

vi.mock("@/hooks/useMediaQuery", () => ({
  useIsMobile: () => mocks.isMobile,
}));

// The real sheet is a Base UI drawer; capture what the dock hands it.
vi.mock("@/components/ui/action-sheet", () => ({
  ActionSheet: (props: {
    open: boolean;
    items: { key: string; label: string; onClick: () => void }[];
  }) => {
    mocks.sheet(props);
    return props.open ? (
      <ul data-testid="more-sheet">
        {props.items.map((item) => (
          <li key={item.key}>
            <button type="button" onClick={item.onClick}>
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    ) : null;
  },
}));

vi.mock("@/components/CameraSettingsModal", () => ({
  CameraSettingsModal: () => null,
}));

import { VoiceControls } from "@/components/voice/VoiceControls";

function renderDock(overrides: Record<string, unknown> = {}) {
  const props = {
    hasMicrophone: true,
    isMicOn: true,
    toggleMic: vi.fn(),
    isDeafened: false,
    toggleDeafen: vi.fn(),
    hasCamera: true,
    isCameraOn: false,
    toggleCamera: vi.fn(),
    isScreenSharing: false,
    toggleScreenShare: vi.fn(),
    setIsScreenModalOpen: vi.fn(),
    focusedItem: null,
    setFocusedId: vi.fn(),
    handleLeave: vi.fn(),
    isFullscreen: false,
    toggleFs: vi.fn(),
    fullscreenSupported: true,
    showMembers: false,
    setShowMembers: vi.fn(),
    onOpenActivities: vi.fn(),
    ...overrides,
  };
  render(
    <TooltipProvider>
      <VoiceControls {...(props as any)} />
    </TooltipProvider>,
  );
  return props;
}

describe("VoiceControls phone dock", () => {
  beforeEach(() => {
    mocks.isMobile = true;
    mocks.sheet.mockClear();
  });

  it("keeps mic, deafen, camera, share, More and Leave in the compact row", () => {
    renderDock();
    for (const name of [
      "Mute",
      "Deafen",
      "Turn on camera",
      "Share screen",
      "More controls",
      "Disconnect",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    // Activities is in the row only for the full layout (container query).
    const activities = screen.getByRole("button", { name: "Activities" });
    expect(activities.className).toContain("hidden");
    expect(activities.className).toContain("@min-[680px]:inline-flex");
    expect(
      screen.getByRole("button", { name: "More controls" }).className,
    ).toContain("@min-[680px]:hidden");
  });

  it("opens an action sheet holding Activities, members and fullscreen", () => {
    const props = renderDock({
      focusedItem: { id: "g-1", isStreaming: false },
    });
    expect(screen.queryByTestId("more-sheet")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "More controls" }));
    const sheet = screen.getByTestId("more-sheet");
    const labels = Array.from(sheet.querySelectorAll("button")).map(
      (b) => b.textContent,
    );
    expect(labels).toEqual(["Activities", "Show members", "Fullscreen"]);

    fireEvent.click(within(sheet).getByText("Activities"));
    expect(props.onOpenActivities).toHaveBeenCalledTimes(1);
  });

  it("leaves fullscreen out of More where the platform cannot do it", () => {
    renderDock({ fullscreenSupported: false });
    fireEvent.click(screen.getByRole("button", { name: "More controls" }));
    expect(screen.getByTestId("more-sheet").textContent).not.toContain(
      "Fullscreen",
    );
  });

  it("shows no More button when there is nothing to fold away", () => {
    renderDock({ onOpenActivities: undefined, fullscreenSupported: false });
    expect(screen.queryByRole("button", { name: "More controls" })).toBeNull();
  });
});

describe("VoiceControls states", () => {
  beforeEach(() => {
    mocks.isMobile = false;
  });

  it("tints muted and live controls and keeps Leave the only solid", () => {
    renderDock({
      isMicOn: false,
      isDeafened: true,
      isCameraOn: true,
      isScreenSharing: true,
    });
    expect(screen.getByRole("button", { name: "Unmute" }).className).toContain(
      "bg-rm-danger-tint",
    );
    expect(
      screen.getByRole("button", { name: "Undeafen" }).className,
    ).toContain("bg-rm-danger-tint");
    for (const name of ["Turn off camera", "Stop sharing"]) {
      const button = screen.getByRole("button", { name });
      expect(button.className).toContain("bg-rm-accent-tint");
      expect(button.className).not.toContain("bg-primary");
    }
    const leave = screen.getByRole("button", { name: "Disconnect" });
    expect(leave.className).toContain("bg-rm-danger ");
  });

  it("uses the destructive tint, not solid, for Stop Watching and Leave Activity", () => {
    const watch = renderDock({ focusedItem: { id: "s", isStreaming: true } });
    const stop = screen.getByRole("button", { name: "Stop Watching" });
    expect(stop.className).toContain("bg-rm-danger-tint");
    expect(stop.className).not.toContain("bg-rm-danger ");
    fireEvent.click(stop);
    expect(watch.setFocusedId).toHaveBeenCalledWith(null);
  });

  it("draws the camera with one glyph: idle at rest, Fill when live", () => {
    renderDock();
    const camera = screen.getByRole("button", { name: "Turn on camera" });
    expect(camera.querySelector("svg")).toBeTruthy();
    expect(camera.className).toContain("bg-rm-tint-1");
  });
});
