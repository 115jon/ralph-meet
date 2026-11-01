import { ProfileSheet } from "@/features/presence/ProfileSheet";

import { closeProfile, useProfileTarget, useSelfProfileOpen } from "./store";
import { UserProfileSheet } from "./UserProfileSheet";

/**
 * Profiles open from anywhere (a message, a member, a friend, a reaction),
 * so they live over the whole app: yours as the status sheet, anyone
 * else's as the profile sheet.
 */
export function ProfileHost() {
  const target = useProfileTarget();
  const selfOpen = useSelfProfileOpen();
  return (
    <>
      <UserProfileSheet target={target} />
      <ProfileSheet visible={selfOpen} onClose={closeProfile} />
    </>
  );
}
