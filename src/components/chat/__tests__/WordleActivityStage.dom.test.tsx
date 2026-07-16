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

  it("uses the shared modal focus and background isolation for hints and settings", async () => {
    render(
      <WordleActivityStage
        sfu={null}
        channelId="channel-1"
        localUserId="user-1"
        participants={[{ userId: "user-1", name: "Ada" }]}
      />,
    );

    await screen.findByText("The New York Times");
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
