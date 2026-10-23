/**
 * Profile surface fixtures (unit 16).
 *
 *   sp-profile-modal[-friend|-pending|-blocked|-error]   UserProfileModal
 *   sp-profile-popover[-banner|-self]                     UserProfilePopover
 *   sp-account-popover                                    UserAccountPopover
 *   sp-avatar-picker                                      AvatarPickerModal
 *   sp-avatar-frame                                       AvatarFrameEditor
 */

import { AvatarFrameEditor } from "@/components/chat/AvatarFrameEditor";
import { AvatarPickerModal } from "@/components/chat/AvatarPickerModal";
import UserAccountPopover from "@/components/chat/UserAccountPopover";
import UserProfileModal from "@/components/chat/UserProfileModal";
import UserProfilePopover from "@/components/chat/UserProfilePopover";
import coverNightdrive from "@/components/dev/assets/cover-nightdrive.webp";
import coverGlasshouse from "@/components/dev/assets/cover-glasshouse.webp";
import shareFrame from "@/components/dev/assets/share-frame.webp";
import type { Relationship, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useEffect, useState, type ReactNode } from "react";
import { at, fail, ok, useApiStub, type StubRoute } from "./api-stub";
import { FIXTURE_ROLES } from "./server";

export const PROFILE_SURFACES = [
  "sp-profile-modal",
  "sp-profile-modal-friend",
  "sp-profile-modal-pending",
  "sp-profile-modal-blocked",
  "sp-profile-modal-error",
  "sp-profile-popover",
  "sp-profile-popover-banner",
  "sp-profile-popover-self",
  "sp-account-popover",
  "sp-avatar-picker",
  "sp-avatar-frame",
];

export const grace: User = {
  id: "u-grace",
  username: "grace",
  display_name: "Grace Hopper",
  status: "idle",
  custom_status: "in a meeting",
  bio: "Wrote the first compiler. Ask me about nanoseconds.",
} as User;

export const ada: User = {
  id: "u-ada",
  username: "ada",
  display_name: "Ada Lovelace",
  status: "online",
  bio: "First programmer. Notes on the Analytical Engine.",
  banner_url: coverNightdrive,
} as User;

export const me: User = {
  id: "u-me",
  username: "jon",
  display_name: "Jon",
  status: "online",
  custom_status: "shipping the UI pass",
  banner_url: coverGlasshouse,
} as User;

export function relationshipFor(surface: string, user: User): Relationship[] {
  const type = surface.endsWith("-friend")
    ? 0
    : surface.endsWith("-blocked")
      ? 1
      : surface.endsWith("-pending")
        ? 2
        : null;
  return type === null ? [] : [{ user, type, created_at: at(600) }];
}

export function profileRoutes(surface: string): StubRoute[] {
  return [
    {
      path: /^\/api\/users\/[^/]+\/profile$/,
      method: "GET",
      reply: ({ url }) => {
        if (surface === "sp-profile-modal-error") {
          return fail(500, "D1_ERROR: no such table: user_profiles");
        }
        const id = url.pathname.split("/")[3];
        const user = id === "u-ada" ? ada : id === "u-me" ? me : grace;
        return ok({
          user,
          mutualFriends: {
            count: 2,
            items: [
              { id: "u-linus", username: "linus", display_name: "Linus" },
              { id: "u-ken", username: "ken", display_name: "Ken" },
            ],
          },
          mutualServers: {
            count: 2,
            items: [
              { id: "s-1", name: "Ralph HQ" },
              { id: "s-3", name: "Night Shift" },
            ],
          },
        });
      },
    },
    {
      path: /^\/api\/servers\/s-1\/roles$/,
      method: "GET",
      reply: () => ok(FIXTURE_ROLES),
    },
    {
      path: /^\/api\/avatars\/history$/,
      method: "GET",
      reply: () =>
        ok({
          items: [
            {
              id: "av-1",
              avatar_url: coverNightdrive,
              content_type: "image/webp",
              created_at: at(60),
            },
            {
              id: "av-2",
              avatar_url: coverGlasshouse,
              content_type: "image/webp",
              created_at: at(6000),
            },
          ],
        }),
    },
  ];
}

export function useSeedRelationships(surface: string, user: User) {
  useEffect(() => {
    useChatStore.setState({
      relationships: relationshipFor(surface, user),
    } as never);
  }, [surface, user]);
}

function Anchored({
  children,
}: {
  children: (anchor: HTMLButtonElement) => ReactNode;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <button
        type="button"
        ref={setAnchor}
        aria-label="Fixture anchor"
        className={cn(
          "fixed z-20 size-8 rounded-full bg-rm-tint-2",
          "top-40 right-[260px] max-md:right-4",
        )}
      />
      {anchor ? children(anchor) : null}
    </>
  );
}

function ProfilesFixture({ surface }: { surface: string }) {
  useApiStub(profileRoutes(surface));
  useSeedRelationships(surface, grace);
  const noop = () => {};

  if (surface.startsWith("sp-profile-modal")) {
    return <UserProfileModal open user={grace} onClose={noop} />;
  }
  if (surface.startsWith("sp-profile-popover")) {
    const user =
      surface === "sp-profile-popover-self"
        ? me
        : surface === "sp-profile-popover-banner"
          ? ada
          : grace;
    return (
      <Anchored>
        {(anchor) => (
          <UserProfilePopover
            userId={user.id}
            username={user.username}
            displayName={user.display_name}
            seedUser={user}
            anchorEl={anchor}
            onClose={noop}
            side="left"
            align="start"
          />
        )}
      </Anchored>
    );
  }
  if (surface === "sp-account-popover") {
    return (
      <Anchored>
        {(anchor) => (
          <UserAccountPopover
            user={me}
            onClose={noop}
            updateStatus={noop}
            onOpenProfileEditor={noop}
            anchorEl={anchor}
          />
        )}
      </Anchored>
    );
  }
  if (surface === "sp-avatar-picker") {
    return (
      <AvatarPickerModal
        open
        displayName="Jon"
        currentAvatarUrl={coverGlasshouse}
        onClose={noop}
        onUpload={noop}
        onSelectRecent={noop}
        showRecent
      />
    );
  }
  if (surface === "sp-avatar-frame") {
    return (
      <AvatarFrameEditor
        image={{ src: shareFrame }}
        displayName="Jon"
        onCancel={noop}
        onConfirm={noop}
      />
    );
  }
  return null;
}

export function renderProfilesFixture(
  surface: string,
  shell: ReactNode,
): ReactNode | null {
  if (!PROFILE_SURFACES.includes(surface)) return null;
  return (
    <div className="relative h-full w-full">
      {shell}
      <ProfilesFixture surface={surface} />
    </div>
  );
}
