// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "@/stores/chat-store";
import { useCallStore } from "@/stores/useCallStore";
import { useCallVoiceStore } from "@/stores/useCallVoiceStore";

import {
  AppConnectionBanner,
  ColumnConnectionSlot,
  GatewayConnectionBanner,
  mergeConnectionIssues,
  StageConnectionBanner,
} from "../ConnectionBanner";

const initGateway = vi.fn();
const wake = vi.fn();

function dropChat(reconnectAttempt: number) {
  useChatStore.setState({
    connected: false,
    reconnectAttempt,
    user: { id: "me" } as never,
    gateway: { ...useChatStore.getState().gateway, initGateway, wake },
  });
}

function banners() {
  return document.querySelectorAll("[data-slot=connection-banner]");
}

describe("one connection banner for chat and call drops (spec §3 rule 4)", () => {
  beforeEach(() => {
    initGateway.mockReset();
    wake.mockReset();
  });
  afterEach(() => {
    cleanup();
    useChatStore.setState({ connected: true, reconnectAttempt: 0 });
    useCallStore.getState().reset?.();
    useCallVoiceStore.getState().reset();
  });

  it("never stacks: a chat drop during a call drop is one banner on the stage", () => {
    dropChat(2);
    render(
      <>
        <GatewayConnectionBanner initialHasConnected deferToStage />
        <StageConnectionBanner connectionState="reconnecting" joined />
      </>,
    );
    const shown = banners();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toHaveAttribute("data-placement", "stage");
    expect(shown[0]).toHaveAttribute("data-state", "reconnecting");
    expect(shown[0]).toHaveTextContent("Chat and the call dropped.");
  });

  it("the stage slot carries a chat-only drop, so the column banner stands down", () => {
    dropChat(2);
    render(
      <>
        <GatewayConnectionBanner initialHasConnected deferToStage />
        <StageConnectionBanner connectionState="connected" joined />
      </>,
    );
    const shown = banners();
    expect(shown).toHaveLength(1);
    expect(shown[0]).toHaveAttribute("data-placement", "stage");
    expect(shown[0]).toHaveTextContent("The chat link dropped.");
  });

  it("off the stage the column strip shows the chat drop, in the flow", () => {
    dropChat(2);
    render(<GatewayConnectionBanner initialHasConnected deferToStage />);
    expect(banners()).toHaveLength(1);
    expect(banners()[0]).toHaveAttribute("data-placement", "column");
    expect(banners()[0]).not.toHaveClass("absolute");
  });

  it("moves under ChatArea's header when its slot is mounted, never twice", async () => {
    dropChat(2);
    render(
      <>
        <GatewayConnectionBanner initialHasConnected />
        <div data-testid="column">
          <ColumnConnectionSlot />
        </div>
      </>,
    );
    await act(async () => {});
    expect(banners()).toHaveLength(1);
    expect(
      screen
        .getByTestId("column")
        .querySelector("[data-slot=connection-banner]"),
    ).not.toBeNull();
  });

  it("both failed: red, and Retry retries both links", () => {
    dropChat(9);
    const retryCall = vi.fn();
    render(
      <>
        <GatewayConnectionBanner initialHasConnected deferToStage />
        <StageConnectionBanner
          connectionState="failed"
          joined
          onRetry={retryCall}
        />
      </>,
    );
    expect(banners()).toHaveLength(1);
    expect(banners()[0]).toHaveAttribute("data-state", "failed");
    expect(banners()[0]).toHaveTextContent("Can't reach chat or the call.");
    act(() => screen.getByRole("button", { name: "Retry" }).click());
    expect(retryCall).toHaveBeenCalledOnce();
    expect(wake).toHaveBeenCalled();
  });

  it("a DM call drop shows in its conversation's column banner, merged with chat", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    useChatStore.setState({ connected: true, activeChannelId: "dm-1" });
    useCallStore.setState({ status: "active", channelId: "dm-1" } as never);
    useCallVoiceStore.setState({ joined: true, connectionState: "failed" });
    render(<AppConnectionBanner stageOnScreen={false} />);
    // The call alone: red, no chat clause.
    expect(banners()).toHaveLength(1);
    expect(banners()[0]).toHaveTextContent("Couldn't reconnect to the call.");
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    act(() => dropChat(2));
    // The chat drop waits out its grace period, then joins the same banner.
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    vi.useRealTimers();
    expect(banners()).toHaveLength(1);
    expect(banners()[0]).toHaveAttribute("data-state", "failed");
    expect(banners()[0]).toHaveTextContent("Chat is reconnecting too.");
  });

  it("joining a call is not a problem: a chat drop speaks over it", () => {
    const chat = {
      source: "chat" as const,
      state: "reconnecting" as const,
      message: "Reconnecting",
    };
    expect(
      mergeConnectionIssues(chat, {
        source: "call",
        state: "connecting",
        message: "Connecting",
      }),
    ).toBe(chat);
  });

  describe("live region", () => {
    afterEach(() => vi.useRealTimers());

    function liveRegion() {
      return banners()[0]!.querySelector("[role=status]")!;
    }

    it("mounts empty, then announces the first message", () => {
      vi.useFakeTimers();
      dropChat(2);
      render(<GatewayConnectionBanner initialHasConnected />);
      expect(liveRegion()).toHaveTextContent(/^$/);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(liveRegion()).toHaveTextContent(
        "Reconnecting. The chat link dropped.",
      );
    });

    it("keeps the attempt counter out of the live region", () => {
      vi.useFakeTimers();
      dropChat(2);
      render(<GatewayConnectionBanner initialHasConnected />);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      const region = liveRegion();
      const said = region.textContent;
      act(() => {
        useChatStore.setState({ reconnectAttempt: 3 });
      });
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(banners()[0]).toHaveTextContent("Try 3");
      expect(liveRegion()).toBe(region);
      expect(region.textContent).toBe(said);
      expect(region).not.toHaveTextContent("Try");
    });

    it("announces a change of state", () => {
      vi.useFakeTimers();
      dropChat(2);
      render(<GatewayConnectionBanner initialHasConnected />);
      act(() => {
        vi.advanceTimersByTime(100);
      });
      act(() => {
        useChatStore.setState({ reconnectAttempt: 9 });
      });
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(liveRegion()).toHaveTextContent("No chat link.");
    });
  });
});
