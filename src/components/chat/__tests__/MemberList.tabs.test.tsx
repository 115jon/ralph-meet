// @vitest-environment jsdom

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { User } from "@/lib/types";
import MemberList from "../MemberList";

const { apiGetMock, apiDeleteMock } = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
  apiDeleteMock: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  apiGet: apiGetMock,
  apiDelete: apiDeleteMock,
}));

describe("MemberList tabs", () => {
  it("ignores an out-of-order response from the previous channel", async () => {
    const pending = new Map<
      string,
      { resolve: (value: unknown) => void; signal?: AbortSignal }
    >();
    apiGetMock.mockImplementation(
      (url: string, options?: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          pending.set(url, { resolve, signal: options?.signal });
        }),
    );

    const { rerender } = render(
      <MemberList members={[]} onlineUsers={new Set()} channelId="channel-a" />,
    );

    fireEvent.click(screen.getAllByRole("tab", { name: "Media" })[0]!);
    await waitFor(() =>
      expect(apiGetMock).toHaveBeenCalledWith(
        "/api/channels/channel-a/media?type=images",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );

    rerender(
      <MemberList members={[]} onlineUsers={new Set()} channelId="channel-b" />,
    );
    await waitFor(() =>
      expect(
        screen.getAllByRole("tab", { name: "Members" })[0],
      ).toHaveAttribute("aria-selected", "true"),
    );

    fireEvent.click(screen.getAllByRole("tab", { name: "Media" })[0]!);
    await waitFor(() =>
      expect(apiGetMock).toHaveBeenCalledWith(
        "/api/channels/channel-b/media?type=images",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );

    pending.get("/api/channels/channel-b/media?type=images")?.resolve({
      items: [
        {
          id: "media-b",
          message_id: "message-b",
          filename: "channel-b.png",
          file_key: "channel-b.png",
          url: "/channel-b.png",
          content_type: "image/png",
          size_bytes: 1,
          source_kind: "attachment",
          author: { id: "user-b", username: "b", avatar_url: null },
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    pending.get("/api/channels/channel-a/media?type=images")?.resolve({
      items: [
        {
          id: "media-a",
          message_id: "message-a",
          filename: "channel-a.png",
          file_key: "channel-a.png",
          url: "/channel-a.png",
          content_type: "image/png",
          size_bytes: 1,
          source_kind: "attachment",
          author: { id: "user-a", username: "a", avatar_url: null },
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    await waitFor(() =>
      expect(screen.getByText("channel-b.png")).toBeVisible(),
    );
    expect(screen.queryByText("channel-a.png")).not.toBeInTheDocument();
    expect(
      pending.get("/api/channels/channel-a/media?type=images")?.signal,
    ).toBeDefined();
    expect(
      pending.get("/api/channels/channel-a/media?type=images")?.signal?.aborted,
    ).toBe(true);
  });

  it("uses roving tab focus and exposes the active panel", () => {
    render(<MemberList members={[]} onlineUsers={new Set()} />);

    const tablist = screen.getAllByRole("tablist", {
      name: "Member details",
    })[0]!;
    const tabs = within(tablist).getAllByRole("tab");
    expect(tablist).toBeInTheDocument();
    expect(tabs[0]).toHaveAttribute("tabindex", "0");
    expect(tabs[1]).toHaveAttribute("tabindex", "-1");

    tabs[0]?.focus();
    fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });
    expect(tabs[1]).toHaveFocus();
    fireEvent.keyDown(tabs[1]!, { key: "Enter" });
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toBeInTheDocument();
  });

  it("keeps mobile and desktop details tab relationships uniquely identified", () => {
    render(
      <MemberList
        members={[]}
        onlineUsers={new Set()}
        showDetails
        channelName="general"
      />,
    );

    const tabs = screen.getAllByRole("tab");
    const ids = tabs.map((tab) => tab.id);
    expect(new Set(ids).size).toBe(ids.length);

    const panel = screen.getByRole("tabpanel");
    const labelId = panel.getAttribute("aria-labelledby");
    expect(labelId).not.toBeNull();
    expect(document.getElementById(labelId ?? "")).toBeInTheDocument();
  });

  it("updates the measured nameplate mask boundary on resize", () => {
    let trailingRight = 280;
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this instanceof HTMLButtonElement) {
          return new DOMRect(100, 0, 200, 40);
        }
        if (
          this instanceof HTMLDivElement &&
          this.className.includes("gap-1.5")
        ) {
          return new DOMRect(trailingRight - 20, 0, 20, 16);
        }
        return new DOMRect();
      });

    try {
      const user = {
        id: "user-1",
        username: "alice",
        nameplate_url: "/nameplate.png",
        presence_platforms: ["web"],
        status: "online",
      } satisfies User;

      render(
        <MemberList members={[{ user }]} onlineUsers={new Set([user.id])} />,
      );

      const memberButton = screen.getByRole("button", {
        name: "alice (Online)",
      });
      const nameplate = screen.getByAltText("alice nameplate");
      const maskScale = () =>
        Number.parseFloat(
          memberButton.style.getPropertyValue("--nameplate-mask-scale"),
        );

      expect(maskScale()).toBeCloseTo(96 / 92.86, 6);
      expect(nameplate.style.getPropertyValue("mask-image")).toContain(
        "var(--nameplate-mask-scale, 1)",
      );

      trailingRight = 250;
      fireEvent(window, new Event("resize"));

      expect(maskScale()).toBeCloseTo(1, 6);
    } finally {
      rectSpy.mockRestore();
    }
  });
});
