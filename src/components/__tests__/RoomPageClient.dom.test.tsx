// @vitest-environment jsdom

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Counts how often the joined-room module is evaluated: the lobby must not
// load it (and the call stack behind it) before a guest shows intent to join.
const voiceView = vi.hoisted(() => ({ evaluations: 0 }));

vi.mock("@/components/RoomVoiceView", () => {
  voiceView.evaluations += 1;
  return { default: () => <div>joined room</div> };
});

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ slug: "standup" }),
  useNavigate: () => vi.fn(),
}));

import RoomPageClient from "@/components/RoomPageClient";

describe("RoomPageClient lobby", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("shows the name prompt without loading the joined room", () => {
    render(<RoomPageClient />);
    expect(screen.getByText("Join standup")).toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toBeInTheDocument();
    expect(voiceView.evaluations).toBe(0);
  });

  it("loads the joined room once a name is typed and renders it on Join", async () => {
    render(<RoomPageClient />);
    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Ada" },
    });
    await waitFor(() => expect(voiceView.evaluations).toBe(1));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Join" }));
    });
    expect(await screen.findByText("joined room")).toBeInTheDocument();
    expect(sessionStorage.getItem("room-guest-name")).toBe("Ada");
  });
});
