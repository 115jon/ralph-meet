// @vitest-environment jsdom

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BanMemberDialog } from "../BanMemberDialog";

describe("BanMemberDialog (replaces window.prompt)", () => {
  it("bans with the typed reason and closes", async () => {
    const promptSpy = vi.spyOn(window, "prompt");
    const onBan = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(
      <BanMemberDialog
        forceMode="dialog"
        target={{ userId: "u-grace", username: "grace" }}
        onClose={onClose}
        onBan={onBan}
      />,
    );
    const dialog = await screen.findByRole("dialog", { name: "Ban member" });
    // A ban is an irreversible confirm: the solid danger fill.
    expect(
      within(dialog).getByRole("button", { name: "Ban grace" }),
    ).toHaveAttribute("data-variant", "danger");
    fireEvent.change(within(dialog).getByLabelText(/Reason/), {
      target: { value: "  spam  " },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ban grace" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onBan).toHaveBeenCalledWith(
      { userId: "u-grace", username: "grace" },
      "spam",
    );
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it("shows the failure in the dialog instead of alert()", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const onBan = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("Forbidden"), { status: 403 }),
      );
    render(
      <BanMemberDialog
        forceMode="dialog"
        target={{ userId: "u-grace", username: "grace" }}
        onClose={vi.fn()}
        onBan={onBan}
      />,
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Ban grace" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "You don't have permission to ban this member.",
    );
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
