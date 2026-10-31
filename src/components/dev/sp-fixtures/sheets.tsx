/**
 * Phone profile sheet fixtures (unit 16). Rendered over the phone shell.
 *
 *   sp-sheet-banner     another member, with a banner image
 *   sp-sheet-friend     a friend (Call shows)
 *   sp-sheet-blocked    a blocked member (Call hides)
 *   sp-sheet-mod        moderator actions (roles, kick, ban)
 *   sp-sheet-me-banner  your own sheet, with a banner
 *   sp-sheet-plain      another member, no banner (theme colours)
 */

import MobileProfileSheet from "@/components/chat/MobileProfileSheet";
import type { User } from "@/lib/types";
import type { ReactNode } from "react";
import { useApiStub } from "./api-stub";
import {
  ada,
  grace,
  me,
  profileRoutes,
  useSeedRelationships,
} from "./profiles";
import { FIXTURE_ROLES } from "./server";

const SHEET_SURFACES = [
  "sp-sheet-banner",
  "sp-sheet-friend",
  "sp-sheet-blocked",
  "sp-sheet-mod",
  "sp-sheet-me-banner",
  "sp-sheet-plain",
];

function SheetFixture({ surface }: { surface: string }) {
  useApiStub(profileRoutes(surface));
  const user: User =
    surface === "sp-sheet-me-banner"
      ? me
      : surface === "sp-sheet-plain"
        ? grace
        : ada;
  useSeedRelationships(surface, user);
  const noop = () => {};
  const mod = surface === "sp-sheet-mod";
  return (
    <MobileProfileSheet
      open
      user={user}
      roles={mod ? FIXTURE_ROLES.slice(1, 3) : undefined}
      onClose={noop}
      onOpenProfileEditor={noop}
      onBan={mod ? noop : undefined}
      onKick={mod ? noop : undefined}
    />
  );
}

export function renderSheetFixture(
  surface: string,
  shell: ReactNode,
): ReactNode | null {
  if (!SHEET_SURFACES.includes(surface)) return null;
  return (
    <div className="relative h-full w-full">
      {shell}
      <SheetFixture surface={surface} />
    </div>
  );
}
