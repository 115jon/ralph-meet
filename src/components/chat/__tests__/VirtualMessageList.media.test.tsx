// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("virtua", async () => {
  const React = await import("react");
  return {
    Virtualizer: forwardRef<
      unknown,
      { children: ReactNode; keepMounted?: number[] }
    >(({ children, keepMounted = [] }, ref) => {
      useImperativeHandle(ref, () => ({ scrollToIndex: () => {} }), []);
      return (
        <div
          data-testid="virtualizer"
          data-keep-mounted={keepMounted.join(",")}
        >
          {children}
        </div>
      );
    }),
  };
});

vi.mock("../MessageItem", () => ({
  default: ({
    message,
    onMediaPlay,
    onMediaStop,
  }: {
    message: Message;
    onMediaPlay?: () => void;
    onMediaStop?: () => void;
  }) => (
    <div data-testid={`row-${message.id}`}>
      <button
        type="button"
        data-testid={`play-${message.id}`}
        onClick={onMediaPlay}
      >
        Play media
      </button>
      <button
        type="button"
        data-testid={`stop-${message.id}`}
        onClick={onMediaStop}
      >
        Stop media
      </button>
    </div>
  ),
}));

import type { Message } from "@/lib/types";
import VirtualMessageList from "../VirtualMessageList";

const message: Message = {
  id: "message-1",
  channel_id: "channel-1",
  author_id: "user-1",
  content: "hello",
  is_pinned: false,
  created_at: "2026-01-01T00:00:00.000Z",
};

describe("VirtualMessageList media pinning", () => {
  it("keeps a row mounted only while its media is active", () => {
    render(
      <VirtualMessageList
        messages={[message]}
        canPin={false}
        hasMore={false}
        loading={false}
        onLoadMore={() => {}}
        onReply={() => {}}
        onPin={() => {}}
        onUnpin={() => {}}
        onJump={() => {}}
      />,
    );

    const virtualizer = screen.getByTestId("virtualizer");
    expect(virtualizer).toHaveAttribute("data-keep-mounted", "");
    fireEvent.click(screen.getByRole("button", { name: "Play media" }));
    expect(virtualizer).toHaveAttribute("data-keep-mounted", "1");
    fireEvent.click(screen.getByRole("button", { name: "Stop media" }));
    expect(virtualizer).toHaveAttribute("data-keep-mounted", "");
  });

  it("reindexes an active media row by message id after prepend and reorder", () => {
    const first = { ...message, id: "message-1" };
    const second = { ...message, id: "message-2" };
    const prepended = { ...message, id: "message-0" };
    const { rerender } = render(
      <VirtualMessageList
        messages={[first, second]}
        canPin={false}
        hasMore={false}
        loading={false}
        onLoadMore={() => {}}
        onReply={() => {}}
        onPin={() => {}}
        onUnpin={() => {}}
        onJump={() => {}}
      />,
    );

    const virtualizer = screen.getByTestId("virtualizer");
    fireEvent.click(screen.getByTestId("play-message-2"));
    expect(virtualizer).toHaveAttribute("data-keep-mounted", "2");

    rerender(
      <VirtualMessageList
        messages={[prepended, first, second]}
        canPin={false}
        hasMore={false}
        loading={false}
        onLoadMore={() => {}}
        onReply={() => {}}
        onPin={() => {}}
        onUnpin={() => {}}
        onJump={() => {}}
      />,
    );
    expect(virtualizer).toHaveAttribute("data-keep-mounted", "3");

    rerender(
      <VirtualMessageList
        messages={[second, prepended, first]}
        canPin={false}
        hasMore={false}
        loading={false}
        onLoadMore={() => {}}
        onReply={() => {}}
        onPin={() => {}}
        onUnpin={() => {}}
        onJump={() => {}}
      />,
    );
    expect(virtualizer).toHaveAttribute("data-keep-mounted", "1");

    fireEvent.click(screen.getByTestId("stop-message-2"));
    expect(virtualizer).toHaveAttribute("data-keep-mounted", "");
  });

  it("drops active media from keepMounted during a restore-context render", () => {
    const observedDuringLayout: string[] = [];
    const LayoutProbe = () => {
      useLayoutEffect(() => {
        observedDuringLayout.push(
          screen.getByTestId("virtualizer").getAttribute("data-keep-mounted") ??
            "",
        );
      });
      return null;
    };

    const { rerender } = render(
      <>
        <LayoutProbe />
        <VirtualMessageList
          messages={[message]}
          initialScrollMessageId="message-1"
          canPin={false}
          hasMore={false}
          loading={false}
          onLoadMore={() => {}}
          onReply={() => {}}
          onPin={() => {}}
          onUnpin={() => {}}
          onJump={() => {}}
        />
      </>,
    );

    fireEvent.click(screen.getByTestId("play-message-1"));
    observedDuringLayout.length = 0;

    rerender(
      <>
        <LayoutProbe />
        <VirtualMessageList
          messages={[message]}
          initialScrollMessageId="message-2"
          canPin={false}
          hasMore={false}
          loading={false}
          onLoadMore={() => {}}
          onReply={() => {}}
          onPin={() => {}}
          onUnpin={() => {}}
          onJump={() => {}}
        />
      </>,
    );

    expect(observedDuringLayout).toEqual([""]);
  });
});
