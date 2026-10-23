// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_PERMISSIONS, PERMISSIONS } from "@/lib/permissions";
import type { Role } from "@/lib/types";
import { useChatStore } from "@/stores/chat-store";

const api = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
  apiUpload: vi.fn(),
}));
vi.mock("@/lib/api-client", () => api);

import ServerSettingsModal from "../ServerSettingsModal";

const ROLES: Role[] = [
  {
    id: "r-everyone",
    server_id: "s-1",
    name: "@everyone",
    color: null,
    permissions: PERMISSIONS.SEND_MESSAGES,
    position: 0,
    is_default: true,
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "r-mod",
    server_id: "s-1",
    name: "Moderator",
    color: "#3e9b4f",
    permissions: PERMISSIONS.KICK_MEMBERS,
    position: 1,
    is_default: false,
    created_at: "2026-01-01T00:00:00Z",
  },
];

const BANS = [
  {
    server_id: "s-1",
    user_id: "u-spam",
    username: "free_nitro_bot",
    reason: "Phishing",
    banned_by_username: "jon",
    created_at: "2026-01-01T00:00:00Z",
  },
];

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

function routeGets(overrides: Record<string, () => Promise<unknown>> = {}) {
  api.apiGet.mockImplementation((url: string) => {
    for (const [suffix, reply] of Object.entries(overrides)) {
      if (url.endsWith(suffix)) return reply();
    }
    if (url.endsWith("/roles")) return Promise.resolve(ROLES);
    if (url.endsWith("/bans")) return Promise.resolve(BANS);
    if (url.endsWith("/invites")) return Promise.resolve([]);
    if (url.endsWith("/audit-logs")) return Promise.resolve([]);
    if (url.endsWith("/settings")) return Promise.resolve({});
    return Promise.resolve([]);
  });
}

const originalWidth = window.innerWidth;
function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)/.exec(query);
    const max = /max-width:\s*(\d+)/.exec(query);
    const matches =
      (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
    return {
      matches,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  fireEvent(window, new Event("resize"));
}

beforeEach(() => {
  vi.clearAllMocks();
  routeGets();
  useChatStore.setState({ user: { id: "u-me" } as never });
});
afterEach(() => setWidth(originalWidth));

type Props = Partial<React.ComponentProps<typeof ServerSettingsModal>>;
function renderModal(props: Props = {}) {
  return render(
    <ServerSettingsModal
      open
      serverId="s-1"
      ownerId="u-me"
      serverName="Ralph HQ"
      iconUrl={null}
      userPermissions={ALL_PERMISSIONS}
      onClose={() => {}}
      onUpdated={() => {}}
      onDeleted={() => {}}
      {...props}
    />,
  );
}

const flush = () => act(async () => {});

describe("ServerSettingsModal", () => {
  it("shows only the pages a moderator may open", () => {
    setWidth(1280);
    renderModal({
      ownerId: "u-ada",
      userPermissions:
        PERMISSIONS.BAN_MEMBERS |
        PERMISSIONS.KICK_MEMBERS |
        PERMISSIONS.VIEW_AUDIT_LOG,
    });
    const nav = screen.getByRole("navigation", {
      name: "Server settings navigation",
    });
    const labels = Array.from(nav.querySelectorAll("button")).map(
      (b) => b.textContent,
    );
    expect(labels).toEqual(["Overview", "Bans", "Audit log"]);
    expect(screen.queryByRole("button", { name: /Delete server/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
  });

  it("pushes the role editor on phones and pops it with the back button", async () => {
    setWidth(390);
    renderModal({ initialTab: "roles", initialRoleId: "r-mod" });
    await flush();
    expect(
      screen.getByRole("heading", { level: 2, name: "Moderator" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back to roles" }));
    expect(
      screen.getByRole("heading", { level: 2, name: "Roles" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Moderator/ }),
    ).toBeInTheDocument();
  });

  it("deletes a role only after the inline confirm, and keeps it open on failure", async () => {
    setWidth(1280);
    const confirmSpy = vi.spyOn(window, "confirm");
    api.apiDelete.mockRejectedValueOnce(httpError(500, "D1_ERROR: boom"));
    renderModal({ initialTab: "roles", initialRoleId: "r-mod" });
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(api.apiDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete role" }));
    await flush();
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(api.apiDelete).toHaveBeenCalledWith("/api/servers/s-1/roles/r-mod");
    expect(
      screen.getByText("Unable to delete Moderator. Try again in a moment."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/D1_ERROR/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Delete role" }),
    ).toBeInTheDocument();
  });

  it("asks before unbanning and shows a failure on the row", async () => {
    setWidth(1280);
    api.apiDelete.mockRejectedValueOnce(httpError(403, "Forbidden"));
    renderModal({ initialTab: "bans" });
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Unban" }));
    expect(api.apiDelete).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Unban free_nitro_bot\? They can rejoin/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unban" }));
    await flush();
    expect(
      screen.getByText("You don't have permission to unban free_nitro_bot."),
    ).toBeInTheDocument();
  });

  it("keeps the audit log heading and hides raw server errors", async () => {
    setWidth(1280);
    routeGets({
      "/audit-logs": () =>
        Promise.reject(httpError(500, "D1_ERROR: no such table")),
    });
    renderModal({ initialTab: "audit" });
    await flush();
    expect(
      screen.getByRole("heading", { level: 2, name: "Audit log" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Audit log didn't load")).toBeInTheDocument();
    expect(screen.queryByText(/D1_ERROR/)).toBeNull();
    routeGets();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await flush();
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });

  it("shows an invites load failure with a retry", async () => {
    setWidth(390);
    routeGets({
      "/invites": () => Promise.reject(httpError(500, "D1_ERROR")),
    });
    renderModal({ initialTab: "invites" });
    await flush();
    expect(screen.getByText("Invite links didn't load")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Unable to load the invite links. Try again in a moment.",
      ),
    ).toBeInTheDocument();
  });

  it("asks for the server name before deleting and keeps the confirm open on failure", async () => {
    setWidth(1280);
    const onDeleted = vi.fn();
    api.apiDelete.mockRejectedValueOnce(httpError(500, "boom"));
    renderModal({ onDeleted });
    fireEvent.click(screen.getByRole("button", { name: "Delete server" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete server" }));
    expect(api.apiDelete).not.toHaveBeenCalled();
    expect(
      screen.getByText("Type Ralph HQ exactly to delete it."),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Type Ralph HQ to confirm"), {
      target: { value: "Ralph HQ" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete server" }));
    await flush();
    expect(api.apiDelete).toHaveBeenCalledWith("/api/servers/s-1/settings");
    expect(onDeleted).not.toHaveBeenCalled();
    expect(
      screen.getByText("Unable to delete this server. Try again in a moment."),
    ).toBeInTheDocument();
  });

  it("saves the overview from the footer and reports it", async () => {
    setWidth(1280);
    const onUpdated = vi.fn();
    api.apiPatch.mockResolvedValueOnce({});
    renderModal({ onUpdated });
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();
    fireEvent.click(
      screen.getByRole("switch", { name: "Let search engines index shares" }),
    );
    fireEvent.click(save);
    await flush();
    expect(api.apiPatch).toHaveBeenCalledWith(
      "/api/servers/s-1/settings",
      expect.objectContaining({ allow_share_indexing: true }),
    );
    expect(onUpdated).toHaveBeenCalled();
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });
});
