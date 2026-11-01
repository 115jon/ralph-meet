import { eventDecoder } from "@/features/realtime/event-decoder";
import { onDispatch, onGatewayReady } from "@/features/realtime/gateway";

import {
  addMember,
  loadedServerIds,
  loadMembers,
  patchMemberProfile,
  removeMember,
  setMemberRoles,
} from "./actions";
import {
  MemberAddEvent,
  MemberRemoveEvent,
  MemberUpdateEvent,
  ProfileUpdateEvent,
} from "./schema";

const decodeAdd = eventDecoder(MemberAddEvent);
const decodeRemove = eventDecoder(MemberRemoveEvent);
const decodeUpdate = eventDecoder(MemberUpdateEvent);
const decodeProfile = eventDecoder(ProfileUpdateEvent);

function handle(event: string, data: unknown): void {
  switch (event) {
    case "GUILD_MEMBER_ADD": {
      const d = decodeAdd(data);
      if (d) addMember(d.server_id, d.user, d.roles);
      return;
    }
    case "GUILD_MEMBER_REMOVE": {
      const d = decodeRemove(data);
      if (d) removeMember(d.server_id, d.user_id);
      return;
    }
    case "GUILD_MEMBER_UPDATE": {
      const d = decodeUpdate(data);
      if (d) setMemberRoles(d.server_id, d.user_id, d.roles);
      return;
    }
    case "USER_PROFILE_UPDATE": {
      const d = decodeProfile(data);
      if (d) patchMemberProfile(d);
      return;
    }
    default:
      return;
  }
}

/** Keeps loaded member lists live; returns the unsubscribe. */
export function startMemberEvents(): () => void {
  const offDispatch = onDispatch(handle);
  // Joins, leaves and role changes sent while the socket was down are gone.
  const offReady = onGatewayReady(() => {
    for (const id of loadedServerIds()) void loadMembers(id, { force: true });
  });
  return () => {
    offDispatch();
    offReady();
  };
}
