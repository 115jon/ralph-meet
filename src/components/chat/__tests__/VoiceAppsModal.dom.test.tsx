// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SFUClient } from "@/lib/sfu-client";
import { useActivityStore } from "@/stores/useActivityStore";
import { VoiceAppsModal } from "../VoiceAppsModal";

const gridItems = [
  { userId: "u-me", name: "Jon", isLocal: true },
  { userId: "u-ada", name: "Ada" },
];

function renderModal(
  props: Partial<React.ComponentProps<typeof VoiceAppsModal>> = {},
) {
  const sendAppEvent = vi.fn();
  const onClose = vi.fn();
  const sfu = { voiceGW: { sendAppEvent } } as unknown as SFUClient;
  render(
    <VoiceAppsModal
      isOpen
      onClose={onClose}
      sfu={sfu}
      channelId="ch-1"
      localUserId="u-me"
      gridItems={gridItems}
      {...props}
    />,
  );
  return { sendAppEvent, onClose };
}

describe("VoiceAppsModal", () => {
  beforeEach(() => {
    useActivityStore.setState({ activeByUser: {} });
  });

  it("is one Activities dialog with both activities and no second step", () => {
    renderModal();

    const dialog = screen.getByRole("dialog", { name: "Activities" });
    expect(dialog).toHaveTextContent("Starts for all 2 people in this call.");
    expect(
      screen.getByRole("button", { name: /Daily Word/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Warp Rush/ }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Voice apps")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /back/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps accepting the old mode prop and shows the same list", () => {
    renderModal({ initialTab: "menu" });
    expect(
      screen.getByRole("button", { name: /Daily Word/ }),
    ).toBeInTheDocument();
  });

  it("describes only things the activities do", () => {
    renderModal();
    const dialog = screen.getByRole("dialog", { name: "Activities" });
    expect(dialog).not.toHaveTextContent(/watch videos/i);
    expect(dialog).not.toHaveTextContent(/gpu|hardware/i);
  });

  it("starts an activity for the call and closes", () => {
    const { sendAppEvent, onClose } = renderModal();

    fireEvent.click(screen.getByRole("button", { name: /Warp Rush/ }));

    expect(sendAppEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "activity.start",
        activity: "warp-rush",
        channelId: "ch-1",
        userId: "u-me",
      }),
    );
    expect(useActivityStore.getState().activeByUser["u-me"]?.activity).toBe(
      "warp-rush",
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("disables the cards when there is no voice channel to start one in", () => {
    const { sendAppEvent } = renderModal({ channelId: null });

    const card = screen.getByRole("button", { name: /Daily Word/ });
    expect(card).toBeDisabled();
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Join a voice channel to start one.",
    );
    fireEvent.click(card);
    expect(sendAppEvent).not.toHaveBeenCalled();
  });
});
