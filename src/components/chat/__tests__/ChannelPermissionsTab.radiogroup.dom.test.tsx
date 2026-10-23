// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PERMISSIONS } from "@/lib/permissions";
import type { Channel, Role } from "@/lib/types";

const roles: Role[] = [
  {
    id: "r-everyone",
    server_id: "s-1",
    name: "@everyone",
    color: null,
    permissions: 0,
    position: 0,
    is_default: true,
    created_at: "",
  },
  {
    id: "r-mod",
    server_id: "s-1",
    name: "Moderator",
    color: "#3e9b4f",
    permissions: 0,
    position: 1,
    is_default: false,
    created_at: "",
  },
];

const api = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPut: vi.fn(() => Promise.resolve({})),
  apiDelete: vi.fn(() => Promise.resolve({})),
  apiPatch: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/lib/api-client", () => api);

api.apiGet.mockImplementation((url: string) => {
  if (url.endsWith("/permissions")) {
    return Promise.resolve([
      {
        target_id: "r-mod",
        target_type: "role",
        allow: PERMISSIONS.MANAGE_MESSAGES,
        deny: PERMISSIONS.ADD_REACTIONS,
      },
    ]);
  }
  if (url.endsWith("/roles")) return Promise.resolve(roles);
  if (url.endsWith("/members")) return Promise.resolve([]);
  return Promise.reject(new Error(`unexpected ${url}`));
});

import ChannelSettingsModal from "../ChannelSettingsModal";

const channel: Channel = {
  id: "ch-general",
  server_id: "s-1",
  name: "general",
  description: null,
  channel_type: "text",
  category_id: "c-text",
  position: 0,
  created_at: "2026-10-01T00:00:00Z",
};

afterEach(() => {
  cleanup();
  api.apiPut.mockClear();
});

function renderEditor() {
  return render(
    <ChannelSettingsModal
      open
      serverId="s-1"
      channel={channel}
      onClose={() => {}}
      initialTab="permissions"
      initialOverrideId="r-mod"
    />,
  );
}

function radios(groupName: string) {
  const group = screen.getByRole("radiogroup", { name: groupName });
  return {
    group,
    deny: within(group).getByRole("radio", { name: "Deny" }),
    inherit: within(group).getByRole("radio", { name: "Inherit" }),
    allow: within(group).getByRole("radio", { name: "Allow" }),
  };
}

describe("ChannelPermissionsTab tri-state rows", () => {
  it("names each group by its permission and each option by its state", async () => {
    renderEditor();
    await screen.findByRole("radiogroup", { name: "Manage messages" });

    const manage = radios("Manage messages");
    expect(within(manage.group).getAllByRole("radio")).toHaveLength(3);
    expect(manage.group).toHaveAccessibleDescription(
      "Delete other people's messages and pin any message.",
    );
    expect(manage.allow).toBeChecked();
    expect(manage.deny).not.toBeChecked();
    expect(manage.inherit).not.toBeChecked();

    expect(radios("Add reactions").deny).toBeChecked();
    expect(radios("Send messages").inherit).toBeChecked();
  });

  it("choosing Allow updates the draft and Save sends the new bits", async () => {
    renderEditor();
    await screen.findByRole("radiogroup", { name: "Send messages" });

    fireEvent.click(radios("Send messages").allow);
    expect(radios("Send messages").allow).toBeChecked();
    expect(radios("Send messages").inherit).not.toBeChecked();
    expect(screen.getByText("You have unsaved changes.")).toBeInTheDocument();

    // Arrow keys move within a native radio group; the browser does it, so
    // here we check every option is a focusable native radio in one group.
    const reactions = radios("Add reactions");
    for (const radio of [reactions.deny, reactions.inherit, reactions.allow]) {
      expect(radio.tagName).toBe("INPUT");
      expect(radio).toHaveAttribute(
        "name",
        reactions.deny.getAttribute("name"),
      );
    }

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(api.apiPut).toHaveBeenCalledTimes(1));
    expect(api.apiPut).toHaveBeenCalledWith(
      "/api/channels/ch-general/permissions/r-mod",
      {
        target_type: "role",
        allow: PERMISSIONS.MANAGE_MESSAGES | PERMISSIONS.SEND_MESSAGES,
        deny: PERMISSIONS.ADD_REACTIONS,
      },
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });
});
