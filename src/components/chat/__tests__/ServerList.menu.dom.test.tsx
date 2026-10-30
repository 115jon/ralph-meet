// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Server } from "@/lib/types";
import ServerList from "../ServerList";

const server = {
  id: "s-1",
  name: "Ralph HQ",
  icon_url: null,
  owner_id: "u-1",
} as unknown as Server;

describe("ServerList context menu", () => {
  it("hides Leave server until the API exists (blocker 3)", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    render(
      <ServerList
        servers={[server]}
        activeServerId={null}
        onSelect={() => {}}
      />,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: /Ralph HQ/ }));

    expect(await screen.findByText("Copy ID")).toBeInTheDocument();
    expect(screen.queryByText("Leave server")).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
