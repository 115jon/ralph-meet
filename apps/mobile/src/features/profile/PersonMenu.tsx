import {
  At,
  ChatCircle,
  Copy,
  Hammer,
  Prohibit,
  SignOut,
  UserMinus,
} from "phosphor-react-native";
import { useState } from "react";
import { View } from "react-native";

import { useSession } from "@/features/auth/session";
import { canCopy, copyText } from "@/features/chat/clipboard";
import { mentionInComposer } from "@/features/chat/composer-bus";
import { getConversation, showChat } from "@/features/conversation/store";
import { openDmWith } from "@/features/dms/actions";
import { blockUser, removeRelationship } from "@/features/friends/actions";
import { RELATIONSHIP, type FriendUser } from "@/features/friends/schema";
import { useRelationshipType } from "@/features/friends/store";
import { banMember, kickMember } from "@/features/members/actions";
import {
  BAN_MEMBERS,
  hasPermission,
  KICK_MEMBERS,
  permissionsOf,
} from "@/features/members/grouping";
import { useServerMembers } from "@/features/members/store";
import { useTheme } from "@/theme";
import { ConfirmSheet, Sheet, SheetRow, Text, type ConfirmRequest } from "@/ui";

import { closeProfile } from "./store";

export interface MenuPerson extends FriendUser {
  /** Display name or username. */
  readonly name: string;
}

interface PersonMenuProps {
  person: MenuPerson | null;
  /** The server the menu was opened in: its moderator rows. */
  serverId: string | null;
  onClose: () => void;
  /** Lead with Message (member and friend rows; a profile has its own key). */
  withMessage?: boolean;
}

/** Your permissions in `serverId` allow kicking and banning `userId`. */
function useModeration(serverId: string | null, userId: string | undefined) {
  const members = useServerMembers(serverId);
  const myId = useSession((s) => s.user?.id);
  if (!serverId || !userId || userId === myId)
    return { kick: false, ban: false };
  if (!members.some((m) => m.user.id === userId)) {
    return { kick: false, ban: false };
  }
  const total = permissionsOf(members, myId);
  return {
    kick: hasPermission(total, KICK_MEMBERS),
    ban: hasPermission(total, BAN_MEMBERS),
  };
}

/** A conversation with a composer is open: Mention has somewhere to go. */
function canMention(): boolean {
  const kind = getConversation()?.kind;
  return kind === "channel" || kind === "dm";
}

/**
 * The quick menu for a person (a member row's long-press, a profile's ⋯):
 * the web's member context menu without Call (no DM calls on the phone
 * yet). Remove, Block, Kick and Ban each ask first.
 */
export function PersonMenu({
  person,
  serverId,
  onClose,
  withMessage = false,
}: PersonMenuProps) {
  const theme = useTheme();
  const relationship = useRelationshipType(person?.id ?? "");
  const myId = useSession((s) => s.user?.id);
  const moderation = useModeration(serverId, person?.id);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const self = person?.id === myId;

  const ask = (request: ConfirmRequest) => {
    onClose();
    setConfirm(request);
  };
  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <>
      <Sheet
        visible={person !== null}
        onClose={onClose}
        label={person ? `${person.name} actions` : "Actions"}
      >
        {person ? (
          <View>
            <Text
              variant="silk"
              tone="ink3"
              numberOfLines={1}
              style={{ paddingHorizontal: 20, paddingBottom: 4 }}
            >
              {person.name}
            </Text>
            {withMessage && !self ? (
              <SheetRow
                icon={ChatCircle}
                label="Message"
                onPress={run(() => {
                  void openDmWith(person.id).then((ok) => {
                    if (ok) closeProfile();
                  });
                })}
              />
            ) : null}
            {canMention() ? (
              <SheetRow
                icon={At}
                label="Mention"
                onPress={run(() => {
                  if (mentionInComposer(person.username)) {
                    closeProfile();
                    showChat();
                  }
                })}
              />
            ) : null}
            {canCopy ? (
              <SheetRow
                icon={Copy}
                label="Copy username"
                onPress={run(() => copyText(person.username))}
              />
            ) : null}
            {canCopy ? (
              <SheetRow
                icon={Copy}
                label="Copy user ID"
                onPress={run(() => copyText(person.id))}
              />
            ) : null}
            {!self && relationship === RELATIONSHIP.friend ? (
              <SheetRow
                icon={UserMinus}
                label="Remove friend"
                danger
                onPress={() =>
                  ask({
                    kicker: person.name,
                    title: "Remove friend",
                    body: `${person.name} will be removed from your friends. You can send a new request later.`,
                    confirm: "Remove",
                    onConfirm: () => void removeRelationship(person),
                  })
                }
              />
            ) : null}
            {!self && relationship === RELATIONSHIP.blocked ? (
              <SheetRow
                icon={Prohibit}
                label="Unblock"
                onPress={run(() => void removeRelationship(person))}
              />
            ) : null}
            {!self && relationship !== RELATIONSHIP.blocked ? (
              <SheetRow
                icon={Prohibit}
                label="Block"
                danger
                onPress={() =>
                  ask({
                    kicker: person.name,
                    title: `Block ${person.name}?`,
                    body: "They won't be able to message you or send you friend requests, and any friendship ends.",
                    confirm: "Block",
                    danger: true,
                    onConfirm: () => void blockUser(person),
                  })
                }
              />
            ) : null}
            {serverId && (moderation.kick || moderation.ban) ? (
              <View
                style={{
                  marginTop: 4,
                  paddingTop: 8,
                  borderTopWidth: 1,
                  borderTopColor: theme.line,
                }}
              >
                <Text
                  variant="silk"
                  tone="ink3"
                  style={{ paddingHorizontal: 20, paddingBottom: 4 }}
                >
                  Moderator actions
                </Text>
                {moderation.kick ? (
                  <SheetRow
                    icon={SignOut}
                    label="Kick"
                    danger
                    onPress={() =>
                      ask({
                        kicker: person.name,
                        title: `Kick ${person.name}?`,
                        body: "They leave the server now and can come back with a new invite.",
                        confirm: "Kick",
                        danger: true,
                        onConfirm: () =>
                          void kickMember(serverId, person.id, person.name),
                      })
                    }
                  />
                ) : null}
                {moderation.ban ? (
                  <SheetRow
                    icon={Hammer}
                    label="Ban"
                    danger
                    onPress={() =>
                      ask({
                        kicker: person.name,
                        title: `Ban ${person.name}?`,
                        body: "They leave the server and can't come back until they're unbanned.",
                        confirm: "Ban",
                        danger: true,
                        onConfirm: () =>
                          void banMember(serverId, person.id, person.name),
                      })
                    }
                  />
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </Sheet>
      <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}
