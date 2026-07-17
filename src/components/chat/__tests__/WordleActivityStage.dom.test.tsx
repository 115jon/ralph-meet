// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getNewYorkDateKey } from "@/lib/wordle";
import { getRevealDuration } from "@/lib/wordle-game";
import { WordleActivityStage } from "../WordleActivityStage";

function wordleStorageKey(userId: string) {
  return `voice-wordle:channel-1:${userId}:${getNewYorkDateKey(new Date())}`;
}

describe("WordleActivityStage reveal lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 1,
              print_date: getNewYorkDateKey(new Date()),
              solution: "crane",
              editor: "Test editor",
              source: "nyt",
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        ),
      ),
    );
  });

  it("keeps the final row visible and disables input until the reveal ends", async () => {
    render(
      <WordleActivityStage
        sfu={null}
        channelId="channel-1"
        localUserId="user-1"
        participants={[{ userId: "user-1", name: "Ada" }]}
      />,
    );

    await screen.findByText("The New York Times");
    for (const letter of "crane") {
      fireEvent.click(screen.getByRole("button", { name: letter }));
    }
    fireEvent.click(screen.getByRole("button", { name: "ENTER" }));

    expect(screen.getByText("Revealing your solve...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "c" })).toBeDisabled();
    expect(screen.queryByText("Solved in 1")).not.toBeInTheDocument();

    await act(async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, getRevealDuration() + 50),
      );
    });
    await waitFor(() =>
      expect(screen.getByText("Solved in 1")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: /invite/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Channel Stats" }));
    expect(
      screen.queryByRole("button", { name: /share/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to puzzle" }));
    expect(screen.getByRole("button", { name: "ENTER" })).toBeInTheDocument();
  });

  it("rejects a dictionary miss without consuming, persisting, or broadcasting", async () => {
    const sendAppEvent = vi.fn();
    const sfu = {
      on: vi.fn(() => () => undefined),
      voiceGW: { sendAppEvent },
    } as unknown as Parameters<typeof WordleActivityStage>[0]["sfu"];

    render(
      <WordleActivityStage
        sfu={sfu}
        channelId="channel-1"
        localUserId="user-1"
        participants={[{ userId: "user-1", name: "Ada" }]}
      />,
    );

    await screen.findByText("The New York Times");
    for (const letter of "zzzzz") {
      fireEvent.click(screen.getByRole("button", { name: letter }));
    }
    fireEvent.click(screen.getByRole("button", { name: "ENTER" }));

    expect(screen.getByText("Not in word list.")).toBeInTheDocument();
    expect(
      screen.queryByText("Revealing your solve..."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /Row 1, column 1: z/i }),
    ).toBeInTheDocument();
    expect(sendAppEvent).not.toHaveBeenCalled();
    expect(localStorage.getItem(wordleStorageKey("user-1"))).toBeNull();
  });

  it("accepts a fetched answer that is absent from the dictionary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: 1,
              print_date: getNewYorkDateKey(new Date()),
              solution: "zzzzz",
              editor: "Test editor",
              source: "nyt",
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        ),
      ),
    );

    render(
      <WordleActivityStage
        sfu={null}
        channelId="channel-1"
        localUserId="user-1"
        participants={[{ userId: "user-1", name: "Ada" }]}
      />,
    );

    await screen.findByText("The New York Times");
    for (const letter of "zzzzz") {
      fireEvent.click(screen.getByRole("button", { name: letter }));
    }
    fireEvent.click(screen.getByRole("button", { name: "ENTER" }));

    expect(screen.getByText("Revealing your solve...")).toBeInTheDocument();
  });

  it("sends a single local-player progress record", async () => {
    const sendAppEvent = vi.fn();
    const sfu = {
      on: vi.fn(() => () => undefined),
      voiceGW: { sendAppEvent },
    } as unknown as Parameters<typeof WordleActivityStage>[0]["sfu"];

    render(
      <WordleActivityStage
        sfu={sfu}
        channelId="channel-1"
        localUserId="user-1"
        participants={[{ userId: "user-1", name: "Ada" }]}
      />,
    );

    await screen.findByText("The New York Times");
    for (const letter of "crane") {
      fireEvent.click(screen.getByRole("button", { name: letter }));
    }
    fireEvent.click(screen.getByRole("button", { name: "ENTER" }));

    expect(sendAppEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "wordle.progress",
        progress: expect.objectContaining({ userId: "user-1" }),
      }),
    );
    const payload = sendAppEvent.mock.calls[0]?.[0] as {
      progress: Record<string, unknown>;
    };
    expect(payload.progress).not.toHaveProperty("user-1");
  });

  it("merges inbound player progress with the existing local map", async () => {
    const listeners: Array<(event: Record<string, unknown>) => void> = [];
    const sfu = {
      on: vi.fn(
        (
          _eventName: string,
          listener: (event: Record<string, unknown>) => void,
        ) => {
          listeners.push(listener);
          return () => undefined;
        },
      ),
      voiceGW: { sendAppEvent: vi.fn() },
    } as unknown as Parameters<typeof WordleActivityStage>[0]["sfu"];
    const dateKey = getNewYorkDateKey(new Date());
    localStorage.setItem(
      wordleStorageKey("user-1"),
      JSON.stringify({
        guesses: [],
        localProgress: {
          userId: "user-1",
          name: "Ada",
          guesses: [],
          streak: 3,
          finished: false,
          missed: false,
        },
        hints: [],
      }),
    );

    render(
      <WordleActivityStage
        sfu={sfu}
        channelId="channel-1"
        localUserId="user-1"
        participants={[
          { userId: "user-1", name: "Ada" },
          { userId: "user-2", name: "Bea" },
        ]}
      />,
    );

    await screen.findByText("The New York Times");
    await act(async () => {
      listeners[0]?.({
        type: "wordle.progress",
        channel_id: "channel-1",
        puzzle_date: dateKey,
        progress: {
          userId: "user-2",
          name: "Bea",
          guesses: ["crane"],
          streak: 1,
          finished: true,
          missed: false,
        },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Open channel stats" }));

    expect(screen.getByText("3 Day")).toBeInTheDocument();
    expect(screen.getByText("3 Days")).toBeInTheDocument();
  });

  it("isolates hydrated guesses by local user", async () => {
    localStorage.setItem(
      wordleStorageKey("user-1"),
      JSON.stringify({
        guesses: ["begat"],
        localProgress: null,
        hints: [],
      }),
    );
    localStorage.setItem(
      wordleStorageKey("user-2"),
      JSON.stringify({
        guesses: ["adieu"],
        localProgress: null,
        hints: [],
      }),
    );

    render(
      <WordleActivityStage
        sfu={null}
        channelId="channel-1"
        localUserId="user-2"
        participants={[{ userId: "user-2", name: "Bea" }]}
      />,
    );

    await screen.findByRole("button", { name: "a" });
    expect(
      screen.getByRole("img", { name: /Row 1, column 1: a/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /Row 2, column 1: empty/i }),
    ).toBeInTheDocument();
  });

  it("filters syntactically valid garbage and caps hydrated guesses after loading the answer", async () => {
    const stored = {
      guesses: ["zzzzz", "qwert", "asdfg", "hjklp", "mnbvc", "plmok"],
      localProgress: null,
      hints: [],
    };
    localStorage.setItem(wordleStorageKey("user-1"), JSON.stringify(stored));
    localStorage.setItem(
      `voice-wordle:channel-1:${getNewYorkDateKey(new Date())}`,
      JSON.stringify(stored),
    );

    render(
      <WordleActivityStage
        sfu={null}
        channelId="channel-1"
        localUserId="user-1"
        participants={[{ userId: "user-1", name: "Ada" }]}
      />,
    );

    await screen.findByText("The New York Times");
    expect(
      screen.getByRole("img", { name: /Row 1, column 1: empty/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Round complete")).not.toBeInTheDocument();
  });

  it("keeps a valid current-answer fallback when filtering hydrated guesses", async () => {
    const stored = {
      guesses: ["zzzzz", "zzzzz", "zzzzz", "zzzzz", "zzzzz", "zzzzz", "crane"],
      localProgress: null,
      hints: [],
    };
    localStorage.setItem(wordleStorageKey("user-1"), JSON.stringify(stored));
    localStorage.setItem(
      `voice-wordle:channel-1:${getNewYorkDateKey(new Date())}`,
      JSON.stringify(stored),
    );

    render(
      <WordleActivityStage
        sfu={null}
        channelId="channel-1"
        localUserId="user-1"
        participants={[{ userId: "user-1", name: "Ada" }]}
      />,
    );

    await screen.findByText("The New York Times");
    await waitFor(() =>
      expect(screen.getByText("Solved in 1")).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("img", { name: /Row 1, column 1: c/i }),
    ).toBeInTheDocument();
  });

  it("persists only local progress after a remote update", async () => {
    const listeners: Array<(event: Record<string, unknown>) => void> = [];
    const sfu = {
      on: vi.fn(
        (
          _eventName: string,
          listener: (event: Record<string, unknown>) => void,
        ) => {
          listeners.push(listener);
          return () => undefined;
        },
      ),
      voiceGW: { sendAppEvent: vi.fn() },
    } as unknown as Parameters<typeof WordleActivityStage>[0]["sfu"];

    render(
      <WordleActivityStage
        sfu={sfu}
        channelId="channel-1"
        localUserId="user-1"
        participants={[
          { userId: "user-1", name: "Ada" },
          { userId: "user-2", name: "Bea" },
        ]}
      />,
    );

    await screen.findByText("The New York Times");
    await act(async () => {
      listeners[0]?.({
        type: "wordle.progress",
        channel_id: "channel-1",
        puzzle_date: getNewYorkDateKey(new Date()),
        progress: {
          userId: "user-2",
          name: "Bea",
          guesses: ["crane"],
          streak: 1,
          finished: true,
          missed: false,
        },
      });
    });
    for (const letter of "adieu") {
      fireEvent.click(screen.getByRole("button", { name: letter }));
    }
    fireEvent.click(screen.getByRole("button", { name: "ENTER" }));

    const persisted = JSON.parse(
      localStorage.getItem(wordleStorageKey("user-1")) ?? "null",
    ) as { localProgress?: { userId?: string }; progress?: unknown } | null;
    expect(persisted?.localProgress?.userId).toBe("user-1");
    expect(persisted).not.toHaveProperty("progress.user-2");
  });

  it("persists anonymous guesses under the explicit anonymous key", async () => {
    render(
      <WordleActivityStage
        sfu={null}
        channelId="channel-1"
        localUserId={null}
        participants={[]}
      />,
    );

    await screen.findByRole("button", { name: "a" });
    for (const letter of "adieu") {
      fireEvent.click(screen.getByRole("button", { name: letter }));
    }
    fireEvent.click(screen.getByRole("button", { name: "ENTER" }));

    const persisted = JSON.parse(
      localStorage.getItem(wordleStorageKey("anonymous")) ?? "null",
    ) as { guesses?: string[]; localProgress?: unknown } | null;
    expect(persisted?.guesses).toEqual(["adieu"]);
    expect(persisted?.localProgress).toBeNull();
  });

  it("preserves inbound player progress during a batched local write", async () => {
    const listeners: Array<(event: Record<string, unknown>) => void> = [];
    const sfu = {
      on: vi.fn(
        (
          _eventName: string,
          listener: (event: Record<string, unknown>) => void,
        ) => {
          listeners.push(listener);
          return () => undefined;
        },
      ),
      voiceGW: { sendAppEvent: vi.fn() },
    } as unknown as Parameters<typeof WordleActivityStage>[0]["sfu"];

    render(
      <WordleActivityStage
        sfu={sfu}
        channelId="channel-1"
        localUserId="user-1"
        participants={[
          { userId: "user-1", name: "Ada" },
          { userId: "user-2", name: "Bea" },
        ]}
      />,
    );

    await screen.findByRole("button", { name: "a" });
    for (const letter of "adieu") {
      fireEvent.click(screen.getByRole("button", { name: letter }));
    }
    await act(async () => {
      listeners[0]?.({
        type: "wordle.progress",
        channel_id: "channel-1",
        puzzle_date: getNewYorkDateKey(new Date()),
        progress: {
          userId: "user-2",
          name: "Bea",
          guesses: ["crane"],
          streak: 1,
          finished: true,
          missed: false,
        },
      });
      fireEvent.click(screen.getByRole("button", { name: "ENTER" }));
    });

    fireEvent.click(screen.getByRole("button", { name: "Open channel stats" }));
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("uses the shared modal focus and background isolation for hints and settings", async () => {
    render(
      <WordleActivityStage
        sfu={null}
        channelId="channel-1"
        localUserId="user-1"
        participants={[{ userId: "user-1", name: "Ada" }]}
      />,
    );

    await screen.findByRole("button", { name: "Open hints" });
    const hintsButton = screen.getByRole("button", { name: "Open hints" });
    hintsButton.focus();
    fireEvent.click(hintsButton);

    const hintsDialog = screen.getByRole("dialog", { name: "Hints" });
    expect(hintsDialog).toHaveAttribute("aria-modal", "true");
    expect(hintsDialog.querySelector("button")).toHaveFocus();
    expect(
      hintsButton.closest("div")?.closest("[aria-hidden='true']"),
    ).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Hints" }),
    ).not.toBeInTheDocument();
    expect(hintsButton).toHaveFocus();

    const settingsButton = screen.getByRole("button", {
      name: "Open Wordle settings",
    });
    settingsButton.focus();
    fireEvent.click(settingsButton);
    expect(
      screen.getByRole("dialog", { name: "Settings" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(settingsButton).toHaveFocus();
  });
});
