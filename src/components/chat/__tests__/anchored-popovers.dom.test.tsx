// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useRef, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { executeBackHandlers } from "@/hooks/useBackButton";
import type { Role, User } from "@/lib/types";
import { useChatStore } from "@/stores/chat-store";

const voice = vi.hoisted(() => ({
  setDevice: vi.fn(),
  updateUserSettings: vi.fn(),
}));

const api = vi.hoisted(() => ({
  apiGet: vi.fn((url: string): Promise<unknown> => {
    if (url.endsWith("/roles")) {
      return Promise.resolve([
        {
          id: "r-mod",
          server_id: "s-1",
          name: "Mods",
          color: null,
          permissions: 0,
          position: 1,
          is_default: false,
          created_at: "",
        },
      ]);
    }
    return new Promise(() => {});
  }),
  apiPut: vi.fn(() => Promise.resolve([])),
}));

vi.mock("@/lib/api-client", () => api);

vi.mock("@kova/react", () => ({
  useUser: () => ({ user: { id: "u-me" } }),
}));

vi.mock("@/lib/useMediaDevices", () => ({
  useMediaDevices: () => ({
    audioInputs: [
      { deviceId: "default", label: "Default Mic", groupId: "g0" },
      { deviceId: "mic-2", label: "USB Mic", groupId: "g2" },
    ],
    audioOutputs: [],
  }),
}));

vi.mock("@/stores/useVoiceSettingsStore", () => {
  const state = {
    getSettings: () => ({
      inputDeviceId: "default",
      outputDeviceId: "default",
      inputVolume: 80,
      outputVolume: 100,
    }),
    setDevice: voice.setDevice,
    updateUserSettings: voice.updateUserSettings,
  };
  return {
    useVoiceSettingsStore: (selector: (s: typeof state) => unknown) =>
      selector(state),
  };
});

import { AudioDeviceMenu } from "../AudioDeviceMenu";
import UserAccountPopover from "../UserAccountPopover";
import UserProfilePopover from "../UserProfilePopover";

const me = {
  id: "u-me",
  username: "me",
  display_name: "Me",
  status: "online",
  custom_status: "Coding",
} as User;

type Render = (
  anchor: HTMLButtonElement,
  anchorRef: React.RefObject<HTMLButtonElement | null>,
  close: () => void,
) => ReactNode;

function Slot({
  render: renderChild,
  anchor,
  anchorRef,
  close,
}: {
  render: Render;
  anchor: HTMLButtonElement;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  close: () => void;
}) {
  return <>{renderChild(anchor, anchorRef, close)}</>;
}

/** Mirrors the callers: the anchor toggles, the host unmounts on close. */
function Host({
  onClose,
  children,
}: {
  onClose: () => void;
  children: Render;
}) {
  const [anchor, setAnchorState] = useState<HTMLButtonElement | null>(null);
  const anchorRef = useRef<HTMLButtonElement | null>(null);
  const setAnchor = (node: HTMLButtonElement | null) => {
    anchorRef.current = node;
    setAnchorState(node);
  };
  const [open, setOpen] = useState(false);
  const close = () => {
    onClose();
    setOpen(false);
  };
  return (
    <>
      <button type="button" ref={setAnchor} onClick={() => setOpen((o) => !o)}>
        Anchor
      </button>
      {open && anchor ? (
        <Slot
          render={children}
          anchor={anchor}
          anchorRef={anchorRef}
          close={close}
        />
      ) : null}
    </>
  );
}

function openFromAnchor() {
  const anchor = screen.getByRole("button", { name: "Anchor" });
  anchor.focus();
  fireEvent.click(anchor);
  return anchor;
}

type Case = {
  name: string;
  role: "dialog" | "menu";
  label: string | RegExp;
  render: (onClose: () => void) => ReactNode;
};

const cases: Case[] = [
  {
    name: "UserProfilePopover",
    role: "dialog",
    label: "User profile for grace",
    render: (onClose) => (
      <Host onClose={onClose}>
        {(anchor, _ref, close) => (
          <UserProfilePopover
            userId="u-grace"
            username="grace"
            displayName="Grace"
            anchorEl={anchor}
            side="left"
            onClose={close}
          />
        )}
      </Host>
    ),
  },
  {
    name: "UserAccountPopover",
    role: "dialog",
    label: "User Account Options",
    render: (onClose) => (
      <Host onClose={onClose}>
        {(anchor, _ref, close) => (
          <UserAccountPopover
            user={me}
            anchorEl={anchor}
            onClose={close}
            updateStatus={vi.fn()}
            onOpenProfileEditor={vi.fn()}
          />
        )}
      </Host>
    ),
  },
  {
    name: "AudioDeviceMenu",
    role: "menu",
    label: "Input Settings",
    render: (onClose) => (
      <Host onClose={onClose}>
        {(_anchor, anchorRef, close) => (
          <AudioDeviceMenu
            mode="input"
            anchorRef={anchorRef}
            onClose={close}
            onOpenVoiceSettings={vi.fn()}
          />
        )}
      </Host>
    ),
  },
];

beforeEach(() => {
  voice.setDevice.mockClear();
  voice.updateUserSettings.mockClear();
});

afterEach(() => {
  cleanup();
});

describe.each(cases)("$name", ({ role, label, render: renderCase }) => {
  it("moves focus in, closes on Escape and returns focus to the anchor", async () => {
    const onClose = vi.fn();
    render(renderCase(onClose));
    const anchor = openFromAnchor();

    const panel = await screen.findByRole(role, { name: label });
    expect(panel.closest("[data-rm-floating-layer]")).not.toBeNull();
    await waitFor(() =>
      expect(panel.contains(document.activeElement)).toBe(true),
    );

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole(role)).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(anchor));
  });

  it("closes on the back button", async () => {
    const onClose = vi.fn();
    render(renderCase(onClose));
    const anchor = openFromAnchor();
    await screen.findByRole(role, { name: label });

    act(() => {
      executeBackHandlers();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole(role)).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(anchor));
  });

  it("a press on the anchor closes it instead of reopening", async () => {
    const onClose = vi.fn();
    render(renderCase(onClose));
    const anchor = openFromAnchor();
    await screen.findByRole(role, { name: label });

    fireEvent.pointerDown(anchor);
    fireEvent.mouseDown(anchor);
    fireEvent.pointerUp(anchor);
    fireEvent.mouseUp(anchor);
    fireEvent.click(anchor);

    await waitFor(() => expect(screen.queryByRole(role)).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("UserAccountPopover status", () => {
  it("sets the status from the status view and returns to the rows", async () => {
    const updateStatus = vi.fn();
    render(
      <Host onClose={vi.fn()}>
        {(anchor, _ref, close) => (
          <UserAccountPopover
            user={me}
            anchorEl={anchor}
            onClose={close}
            updateStatus={updateStatus}
            onOpenProfileEditor={vi.fn()}
          />
        )}
      </Host>,
    );
    openFromAnchor();
    await screen.findByRole("dialog", { name: "User Account Options" });
    expect(screen.queryByText("Switch Accounts")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Online" }));
    const back = screen.getByRole("button", {
      name: "Back to account options",
    });
    await waitFor(() => expect(document.activeElement).toBe(back));
    expect(screen.getByRole("radio", { name: "Online" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    fireEvent.click(screen.getByRole("radio", { name: "Idle" }));
    expect(updateStatus).toHaveBeenCalledWith("idle", "Coding");
    expect(screen.getByRole("button", { name: "Online" })).toBeInTheDocument();
  });

  it("Escape in the custom status field cancels the edit, not the popover", async () => {
    const onClose = vi.fn();
    const updateStatus = vi.fn();
    render(
      <Host onClose={onClose}>
        {(anchor, _ref, close) => (
          <UserAccountPopover
            user={me}
            anchorEl={anchor}
            onClose={close}
            updateStatus={updateStatus}
            onOpenProfileEditor={vi.fn()}
          />
        )}
      </Host>,
    );
    openFromAnchor();
    await screen.findByRole("dialog", { name: "User Account Options" });

    fireEvent.click(screen.getByRole("button", { name: "Edit custom status" }));
    const input = screen.getByRole("textbox", { name: "Custom status" });
    expect(input).toHaveAttribute("placeholder", "Set a custom status");
    fireEvent.change(input, { target: { value: "Away" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
    expect(updateStatus).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "User Account Options" }),
    ).toBeInTheDocument();
  });
});

describe("AudioDeviceMenu devices", () => {
  it("selects a device through the voice settings store", async () => {
    render(
      <Host onClose={vi.fn()}>
        {(_anchor, anchorRef, close) => (
          <AudioDeviceMenu
            mode="input"
            anchorRef={anchorRef}
            onClose={close}
            onOpenVoiceSettings={vi.fn()}
          />
        )}
      </Host>,
    );
    openFromAnchor();
    await screen.findByRole("menu", { name: "Input Settings" });

    fireEvent.click(screen.getByRole("menuitem", { name: /Input Device/ }));
    const usb = await screen.findByRole("menuitemradio", { name: "USB Mic" });
    expect(
      screen.getByRole("menuitemradio", { name: "Default Mic" }),
    ).toHaveAttribute("aria-checked", "true");

    fireEvent.click(usb);
    expect(voice.setDevice).toHaveBeenCalledWith("input", "mic-2", "u-me", {
      label: "USB Mic",
      groupId: "g2",
    });
  });

  it("changes the volume and opens voice settings", async () => {
    const onClose = vi.fn();
    const onOpenVoiceSettings = vi.fn();
    render(
      <Host onClose={onClose}>
        {(_anchor, anchorRef, close) => (
          <AudioDeviceMenu
            mode="input"
            anchorRef={anchorRef}
            onClose={close}
            onOpenVoiceSettings={onOpenVoiceSettings}
          />
        )}
      </Host>,
    );
    openFromAnchor();
    await screen.findByRole("menu", { name: "Input Settings" });

    fireEvent.change(screen.getByRole("slider", { name: "Input volume" }), {
      target: { value: "40" },
    });
    expect(voice.updateUserSettings).toHaveBeenCalled();
    const update = voice.updateUserSettings.mock.calls[0]![0] as (
      s: object,
    ) => object;
    expect(update({})).toEqual({ inputVolume: 40 });

    fireEvent.click(screen.getByRole("menuitem", { name: "Voice Settings" }));
    expect(onOpenVoiceSettings).toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe("UserProfilePopover roles", () => {
  it("assigns a role from the nested add-role menu without closing", async () => {
    const adminRole = {
      id: "r-admin",
      server_id: "s-1",
      name: "Admin",
      color: null,
      permissions: 4,
      position: 2,
      is_default: false,
      created_at: "",
    } as Role;
    useChatStore.setState({
      user: me,
      activeServerId: "s-1",
      members: [
        { user: me, roles: [adminRole] },
        { user: { id: "u-grace", username: "grace" } as User, roles: [] },
      ] as never,
    });
    const onClose = vi.fn();
    render(
      <Host onClose={onClose}>
        {(anchor, _ref, close) => (
          <UserProfilePopover
            userId="u-grace"
            username="grace"
            anchorEl={anchor}
            onClose={close}
          />
        )}
      </Host>,
    );
    openFromAnchor();
    await screen.findByRole("dialog", { name: "User profile for grace" });

    fireEvent.click(screen.getByRole("button", { name: "Add a role" }));
    const role = await screen.findByRole("menuitemcheckbox", { name: "Mods" });
    fireEvent.click(role);

    expect(api.apiPut).toHaveBeenCalledWith(
      "/api/servers/s-1/members/u-grace/roles",
      { roleIds: ["r-mod"] },
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "User profile for grace" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(role, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
  });
});
