/**
 * Channel settings fixtures.
 *
 *   sp-channel              overview
 *   sp-channel-permissions  permissions, with the Moderator override open so
 *                           the deny / inherit / allow rows show
 */

import ChannelSettingsModal from "@/components/chat/ChannelSettingsModal";
import { PERMISSIONS } from "@/lib/permissions";
import type { Channel } from "@/lib/types";
import type { ReactNode } from "react";
import { at, ok, useApiStub, type StubRoute } from "./api-stub";
import { FIXTURE_ROLES } from "./server";

export const CHANNEL_SURFACES = ["sp-channel", "sp-channel-permissions"];

const channel: Channel = {
  id: "ch-general",
  server_id: "s-1",
  name: "general",
  description: "Day-to-day chat for the crew.",
  channel_type: "text",
  category_id: "c-text",
  position: 1,
  created_at: at(9000),
};

const overrides = [
  {
    id: "o-mod",
    target_id: "r-mod",
    target_type: "role" as const,
    allow: PERMISSIONS.MANAGE_MESSAGES | PERMISSIONS.ATTACH_FILES,
    deny: PERMISSIONS.ADD_REACTIONS,
    name: "Moderator",
    color: "#3e9b4f",
  },
  {
    id: "o-everyone",
    target_id: "r-everyone",
    target_type: "role" as const,
    allow: 0,
    deny: PERMISSIONS.ATTACH_FILES,
    name: "@everyone",
    color: null,
  },
  {
    id: "o-grace",
    target_id: "u-grace",
    target_type: "user" as const,
    allow: PERMISSIONS.MANAGE_MESSAGES,
    deny: 0,
    name: "grace",
  },
];

const routes: StubRoute[] = [
  {
    path: /^\/api\/channels\/ch-general\/permissions$/,
    method: "GET",
    reply: () => ok(overrides),
  },
  {
    path: /^\/api\/servers\/s-1\/roles$/,
    method: "GET",
    reply: () => ok(FIXTURE_ROLES),
  },
  {
    path: /^\/api\/servers\/s-1\/members$/,
    method: "GET",
    reply: () =>
      ok([
        {
          user_id: "u-grace",
          user: {
            id: "u-grace",
            username: "grace",
            display_name: "Grace Hopper",
          },
        },
        {
          user_id: "u-ada",
          user: { id: "u-ada", username: "ada", display_name: "Ada Lovelace" },
        },
      ]),
  },
];

function ChannelFixture({ surface }: { surface: string }) {
  useApiStub(routes);
  // Read by the rebuilt modal; older builds ignore them.
  const extra = {
    initialTab:
      surface === "sp-channel-permissions" ? "permissions" : "overview",
    initialOverrideId:
      surface === "sp-channel-permissions" ? "r-mod" : undefined,
  } as object;
  return (
    <ChannelSettingsModal
      open
      serverId="s-1"
      channel={channel}
      userPermissions={PERMISSIONS.ADMINISTRATOR}
      onClose={() => {}}
      {...extra}
    />
  );
}

export function renderChannelFixture(
  surface: string,
  shell: ReactNode,
): ReactNode | null {
  if (!CHANNEL_SURFACES.includes(surface)) return null;
  return (
    <div className="relative h-full w-full">
      {shell}
      <ChannelFixture surface={surface} />
    </div>
  );
}
