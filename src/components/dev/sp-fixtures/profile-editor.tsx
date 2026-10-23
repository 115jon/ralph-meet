/**
 * Profile editor fixtures, through both ways in.
 *
 *   sp-profile-editor          Settings → Account → Edit profile (stacked)
 *   sp-profile-editor-panel    the user panel's mount
 *   sp-profile-editor-nouser   no signed-in user (the editor must still close)
 */

import ProfileEditorModal from "@/components/chat/ProfileEditorModal";
import SettingsModal from "@/components/chat/SettingsModal";
import { useChatStore } from "@/stores/chat-store";
import { useEffect, type ReactNode } from "react";
import { ok, useApiStub, type StubRoute } from "./api-stub";

export const PROFILE_EDITOR_SURFACES = [
  "sp-profile-editor",
  "sp-profile-editor-panel",
  "sp-profile-editor-nouser",
];

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
];

function ProfileEditorFixture({ surface }: { surface: string }) {
  useApiStub(routes);
  useEffect(() => {
    if (surface === "sp-profile-editor-nouser") {
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
      authUserLoaded={surface !== "sp-profile-editor-nouser"}
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
