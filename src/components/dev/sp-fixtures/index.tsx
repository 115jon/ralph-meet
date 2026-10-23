/**
 * Settings and profile fixtures (design-audit units 15/16). Every surface is
 * prefixed `sp-`; each area lives in its own file so they can change
 * independently. See the file headers for the surface lists.
 */

import type { ReactNode } from "react";
import { renderChannelFixture } from "./channel";
import { renderProfileEditorFixture } from "./profile-editor";
import { renderProfilesFixture } from "./profiles";
import { renderRoomCameraFixture } from "./room-camera";
import { renderServerFixture } from "./server";
import { renderSheetFixture } from "./sheets";

export function isSettingsProfileFixture(surface: string): boolean {
  return surface.startsWith("sp-");
}

export function SettingsProfileFixture({
  surface,
  shell,
}: {
  surface: string;
  /** The chat shell to render underneath (phones show the mobile shell). */
  shell: ReactNode;
}) {
  return (
    renderServerFixture(surface, shell) ??
    renderChannelFixture(surface, shell) ??
    renderRoomCameraFixture(surface, shell) ??
    renderProfileEditorFixture(surface, shell) ??
    renderProfilesFixture(surface, shell) ??
    renderSheetFixture(surface, shell) ?? (
      <p className="p-6 text-ui-sm text-rm-text">Unknown surface {surface}</p>
    )
  );
}
