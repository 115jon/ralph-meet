// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  type ComponentProps,
  type ReactNode,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const virtuaCallbacks = vi.hoisted(() => ({
  onScroll: undefined as ((offset: number) => void) | undefined,
  onScrollEnd: undefined as (() => void) | undefined,
}));

vi.mock("virtua", () => ({
  Virtualizer: forwardRef<
    unknown,
    {
      children: ReactNode | ((item: unknown, index: number) => ReactNode);
      data?: ArrayLike<unknown>;
      keepMounted?: number[];
      onScroll?: (offset: number) => void;
      onScrollEnd?: () => void;
    }
  >(({ children, data, keepMounted = [], onScroll, onScrollEnd }, ref) => {
    useEffect(() => {
      virtuaCallbacks.onScroll = onScroll;
      virtuaCallbacks.onScrollEnd = onScrollEnd;
      return () => {
        virtuaCallbacks.onScroll = undefined;
        virtuaCallbacks.onScrollEnd = undefined;
      };
    }, [onScroll, onScrollEnd]);
    useImperativeHandle(
      ref,
      () => ({
        scrollToIndex: () => {},
        findItemIndex: () => 0,
        scrollOffset: 0,
        scrollSize: 4000,
        viewportSize: 400,
      }),
      [],
    );
    const content =
      typeof children === "function"
        ? Array.from(data ?? []).map((item, index) => children(item, index))
        : children;
    return (
      <div data-testid="virtualizer" data-keep-mounted={keepMounted.join(",")}>
        {content}
      </div>
    );
  }),
}));

vi.mock("../MessageItem", () => ({
  default: ({ message }: { message: { id: string } }) => (
    <div data-testid={`row-${message.id}`}>{message.id}</div>
  ),
}));

import type { Message } from "@/lib/types";
import { setMessageListScrolling } from "../message-list-scroll";
import VirtualMessageList from "../VirtualMessageList";

const message: Message = {
  id: "message-1",
  channel_id: "channel-1",
  author_id: "user-1",
  content: "hello",
  is_pinned: false,
  created_at: "2026-01-01T00:00:00.000Z",
};

function listProps(
  overrides: Partial<ComponentProps<typeof VirtualMessageList>> = {},
) {
  return {
    messages: [message],
    canPin: false,
    hasMore: true,
    loading: false,
    onLoadMore: () => {},
    onReply: () => {},
    onPin: () => {},
    onUnpin: () => {},
    onJump: () => {},
    ...overrides,
  };
}

async function flushRestore() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  });
}

describe("VirtualMessageList fast scroll", () => {
  afterEach(() => {
    setMessageListScrolling(false);
  });

  it("does not fetch older history until scrolling stops", async () => {
    const onLoadMore = vi.fn();
    render(<VirtualMessageList {...listProps({ onLoadMore })} />);
    await flushRestore();

    expect(virtuaCallbacks.onScroll).toBeTypeOf("function");
    act(() => {
      virtuaCallbacks.onScroll?.(0);
    });
    expect(onLoadMore).not.toHaveBeenCalled();

    await act(async () => {
      virtuaCallbacks.onScrollEnd?.();
    });
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("marks the scroller while the thumb is moving", async () => {
    render(<VirtualMessageList {...listProps()} />);
    await flushRestore();

    const scroller = screen.getByTestId("virtualizer").parentElement;
    expect(scroller).not.toHaveClass("is-scrolling");

    act(() => {
      virtuaCallbacks.onScroll?.(1200);
    });
    expect(scroller).toHaveClass("is-scrolling");

    act(() => {
      virtuaCallbacks.onScrollEnd?.();
    });
    expect(scroller).not.toHaveClass("is-scrolling");
  });

  it("reports the visible range once when scrolling ends", async () => {
    const onScrollRangeChange = vi.fn();
    render(<VirtualMessageList {...listProps({ onScrollRangeChange })} />);
    await flushRestore();

    act(() => {
      virtuaCallbacks.onScroll?.(200);
      virtuaCallbacks.onScroll?.(80);
      virtuaCallbacks.onScroll?.(0);
    });
    expect(onScrollRangeChange).not.toHaveBeenCalled();

    act(() => {
      virtuaCallbacks.onScrollEnd?.();
    });
    expect(onScrollRangeChange).toHaveBeenCalledTimes(1);
    expect(onScrollRangeChange).toHaveBeenCalledWith(0);
  });
});
