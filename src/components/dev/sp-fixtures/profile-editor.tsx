/**
 * Profile editor fixtures, through both ways in.
 *
 *   sp-profile-editor          Settings → Account → Edit profile (stacked)
 *   sp-profile-editor-panel    the user panel's mount
 *   sp-profile-editor-nouser   no signed-in user (the editor must still close)
 *   sp-profile-editor-loading  no user yet, auth still loading (spinner)
 *   sp-profile-editor-dirty    a draft with unsaved changes (footer save bar)
 *   sp-profile-editor-error    a save that failed (RowError above the bar)
 */

import ProfileEditorModal from "@/components/chat/ProfileEditorModal";
import SettingsModal from "@/components/chat/SettingsModal";
import { useChatStore } from "@/stores/chat-store";
import { useEffect, type ReactNode } from "react";
import { describeApiError } from "@/lib/api-errors";
import { fail, ok, useApiStub, type StubRoute } from "./api-stub";

const PROFILE_EDITOR_SURFACES = [
  "sp-profile-editor",
  "sp-profile-editor-panel",
  "sp-profile-editor-nouser",
  "sp-profile-editor-loading",
  "sp-profile-editor-dirty",
  "sp-profile-editor-error",
];

const DIRTY_DRAFT = {
  pronouns: "he/him",
  bio: "Building Ralph Meet. Ask me about the voice stack.",
  customStatus: "Shipping the settings workbench",
};

const routes: StubRoute[] = [
  {
    path: /^\/api\/account-claims$/,
    method: "GET",
    reply: () => ok({ claimed: true, candidates: [] }),
  },
  {
    path: /^\/api\/avatars\/history$/,
    method: "GET",
    reply: () => ok({ items: [] }),
  },
  {
    path: /^\/api\/update-profile$/,
    method: "PATCH",
    reply: () => fail(500),
  },
];

function ProfileEditorFixture({ surface }: { surface: string }) {
  useApiStub(routes);
  useEffect(() => {
    if (
      surface === "sp-profile-editor-nouser" ||
      surface === "sp-profile-editor-loading"
    ) {
      useChatStore.setState({ user: null } as never);
    }
  }, [surface]);
  if (surface === "sp-profile-editor") {
    return <SettingsModal open onClose={() => {}} initialProfileEditorOpen />;
  }
  return (
    <ProfileEditorModal
      open
      onClose={() => {}}
      authUserLoaded={surface !== "sp-profile-editor-loading"}
      initialDraft={
        surface === "sp-profile-editor-dirty" ||
        surface === "sp-profile-editor-error"
          ? DIRTY_DRAFT
          : undefined
      }
      initialError={
        surface === "sp-profile-editor-error"
          ? describeApiError({ status: 500 }, "save your profile")
          : undefined
      }
    />
  );
}

export function renderProfileEditorFixture(
  surface: string,
  shell: ReactNode,
): ReactNode | null {
  if (!PROFILE_EDITOR_SURFACES.includes(surface)) return null;
  return (
    <div className="relative h-full w-full">
      {shell}
      <ProfileEditorFixture surface={surface} />
    </div>
  );
}
