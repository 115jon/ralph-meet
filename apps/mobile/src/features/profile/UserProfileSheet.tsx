import {
  ChatCircle,
  Clock,
  DotsThree,
  UserPlus,
  X,
} from "phosphor-react-native";
import { useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";

import { Markdown } from "@/features/chat/markdown/Markdown";
import { parseMessage } from "@/features/chat/markdown/parse";
import { useConversation } from "@/features/conversation/store";
import { openDmWith } from "@/features/dms/actions";
import {
  acceptFriend,
  removeRelationship,
  sendFriendRequest,
} from "@/features/friends/actions";
import { personName } from "@/features/friends/filters";
import { RELATIONSHIP } from "@/features/friends/schema";
import { useRelationshipType } from "@/features/friends/store";
import type { Role } from "@/features/members/schema";
import { useServerMember } from "@/features/members/store";
import {
  PRESENCE_LABEL,
  presenceLedOf,
  useCustomStatus,
  usePresence,
} from "@/features/presence/live";
import { useChannelServer, useServersStore } from "@/features/servers/store";
import { mediaUrl } from "@/lib/api";
import { tapHaptic } from "@/lib/haptics";
import { FONT, RADIUS, useTheme } from "@/theme";
import {
  Avatar,
  Button,
  ConfirmSheet,
  Icon,
  Led,
  RemoteImage,
  Sheet,
  Skeleton,
  SquareKey,
  Text,
  useSheetScroll,
  type ConfirmRequest,
} from "@/ui";

import { AvatarDecoration, ProfileEffect } from "./Collectibles";
import { PersonMenu, type MenuPerson } from "./PersonMenu";
import type { Profile } from "./schema";
import {
  closeProfile,
  openProfile,
  useProfile,
  useProfileFailed,
  type ProfileTarget,
} from "./store";
import {
  nameLook,
  parseCollectibles,
  parseDisplayNameStyle,
  profileColors,
  roleColor,
  type ProfileColors,
} from "./style";

const BANNER = 108;
const AVATAR = 80;

const memberSince = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** The server whose roles the sheet shows: the open channel's. */
function useContextServerId(): string | null {
  const conversation = useConversation();
  const server = useChannelServer(
    conversation?.kind === "channel" ? conversation.id : "",
  );
  return server?.id ?? null;
}

/** "General · Predators Only" while they sit in a voice channel we can see. */
function useVoiceWhere(userId: string): string | null {
  const voice = useServersStore((s) => s.voice);
  const trees = useServersStore((s) => s.trees);
  const servers = useServersStore((s) => s.servers);
  return useMemo(() => {
    for (const [channelId, members] of Object.entries(voice)) {
      if (!members.some((m) => m.user_id === userId)) continue;
      for (const [serverId, tree] of Object.entries(trees)) {
        const channel = tree.channels.find((c) => c.id === channelId);
        if (!channel) continue;
        const server = servers.find((s) => s.id === serverId);
        return server ? `${channel.name} · ${server.name}` : channel.name;
      }
    }
    return null;
  }, [voice, trees, servers, userId]);
}

/** A labelled block in the web's fixed order (ProfileSections). */
function Section({
  title,
  count,
  colors,
  children,
}: {
  title: string;
  count?: number;
  colors: ProfileColors;
  children: ReactNode;
}) {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 16, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 6 }}>
        <Text
          variant="row"
          accessibilityRole="header"
          style={{
            fontSize: 12,
            lineHeight: 16,
            fontFamily: FONT.rowStrong,
            color: colors.ink2,
          }}
        >
          {title}
        </Text>
        {count !== undefined ? (
          <Text variant="num" style={{ fontSize: 11, color: colors.ink2 }}>
            {count}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Chips({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {children}
    </View>
  );
}

/** A 28px tint chip: a dot or a small avatar, then a name. */
function Chip({
  label,
  lead,
  onPress,
}: {
  label: string;
  lead: ReactNode;
  onPress?: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={onPress ? `${label}'s profile` : label}
      disabled={!onPress}
      onPress={onPress}
      hitSlop={{ top: 6, bottom: 6 }}
      style={({ pressed }) => ({
        minHeight: 28,
        maxWidth: "100%",
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingLeft: 4,
        paddingRight: 8,
        borderRadius: RADIUS,
        backgroundColor: pressed ? theme.tint3 : theme.tint2,
      })}
    >
      {lead}
      <Text
        variant="row"
        numberOfLines={1}
        style={{ flexShrink: 1, fontSize: 13, lineHeight: 18 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function RoleDot({ role }: { role: Role }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 10,
        height: 10,
        marginLeft: 4,
        borderRadius: 999,
        backgroundColor: roleColor(role.color, theme.ply3) ?? theme.inkOff,
      }}
    />
  );
}

/** Presence as an LED and silkscreen word, then the custom status. */
function StatusLine({
  userId,
  fallbackStatus,
  fallbackCustom,
  colors,
}: {
  userId: string;
  fallbackStatus: string | null | undefined;
  fallbackCustom: string | null | undefined;
  colors: ProfileColors;
}) {
  const presence = usePresence(userId, fallbackStatus);
  const custom = useCustomStatus(userId, fallbackCustom);
  const voice = useVoiceWhere(userId);
  const led = voice ? "talk" : (presenceLedOf(presence) ?? "off");
  const word = voice ? "In voice" : PRESENCE_LABEL[presence];
  const detail = voice ?? custom;
  return (
    <View
      accessible
      accessibilityLabel={[word, detail].filter(Boolean).join(", ")}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        marginTop: 8,
      }}
    >
      <Led state={led} size={8} />
      <Text variant="silk" style={{ color: colors.ink2 }}>
        {word}
      </Text>
      {detail ? (
        <Text
          variant="row"
          numberOfLines={1}
          style={{
            flexShrink: 1,
            fontSize: 13,
            lineHeight: 18,
            color: colors.ink,
          }}
        >
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

interface Seedish {
  readonly id: string;
  readonly username: string;
  readonly display_name?: string | null;
  readonly avatar_url?: string | null;
}

/**
 * The sheet's body: banner, avatar, name, status, the relationship's
 * actions, then About me, Roles, Mutuals and Member since.
 */
function ProfileBody({
  person,
  profile,
  failed,
  serverId,
  colors,
  width,
  onDismiss,
  onMenu,
}: {
  person: Seedish;
  profile: Profile | null;
  failed: boolean;
  serverId: string | null;
  colors: ProfileColors;
  width: number;
  onDismiss: () => void;
  onMenu: () => void;
}) {
  const user = profile?.user;
  const name = personName(user ?? person);
  const relationship = useRelationshipType(person.id);
  const member = useServerMember(serverId, person.id);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const style = parseDisplayNameStyle(user?.display_name_style);
  const collectibles = parseCollectibles(user?.avatar_display);
  const decoration = collectibles?.avatarDecoration?.imageUrl;
  const banner =
    user?.banner_url && !user.banner_content_type?.startsWith("video/")
      ? user.banner_url
      : null;
  const roles = (member?.roles ?? [])
    .filter((role) => !role.is_default)
    .sort((a, b) => b.position - a.position);
  const since = member?.joined_at ?? user?.created_at ?? null;
  const bio = user?.bio?.trim();
  const bioBlocks = useMemo(
    () => (bio ? parseMessage(`bio:${person.id}`, bio) : []),
    [bio, person.id],
  );
  const handle = [
    `@${user?.username ?? person.username}`,
    user?.pronouns?.trim(),
  ]
    .filter(Boolean)
    .join(" · ");
  const friendUser = {
    id: person.id,
    username: user?.username ?? person.username,
    display_name: user?.display_name ?? person.display_name,
    avatar_url: user?.avatar_url ?? person.avatar_url,
  };

  const message = () => {
    tapHaptic();
    void openDmWith(person.id).then((ok) => {
      if (ok) onDismiss();
    });
  };

  let actions: ReactNode;
  if (relationship === RELATIONSHIP.incoming) {
    actions = (
      <>
        <View style={{ flex: 1 }}>
          <Button
            label="Accept"
            onPress={() => void acceptFriend(friendUser)}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            variant="ghost"
            label="Ignore"
            onPress={() => void removeRelationship(friendUser)}
          />
        </View>
        <SquareKey
          icon={ChatCircle}
          label="Message"
          tone="outline"
          size={48}
          onPress={message}
        />
      </>
    );
  } else {
    actions = (
      <>
        <View style={{ flex: 1 }}>
          <Button label="Message" onPress={message} />
        </View>
        {relationship === null ? (
          <SquareKey
            icon={UserPlus}
            label="Add friend"
            tone="outline"
            size={48}
            onPress={() => void sendFriendRequest(friendUser.username)}
          />
        ) : relationship === RELATIONSHIP.outgoing ? (
          <SquareKey
            icon={Clock}
            label="Request pending. Tap to cancel"
            tone="outline"
            size={48}
            onPress={() =>
              setConfirm({
                kicker: name,
                title: "Cancel request",
                body: `Cancel your friend request to ${name}?`,
                confirm: "Cancel request",
                onConfirm: () => void removeRelationship(friendUser),
              })
            }
          />
        ) : null}
      </>
    );
  }

  return (
    <>
      <View>
        {banner ? (
          <RemoteImage
            url={banner}
            style={{ height: BANNER, backgroundColor: colors.banner }}
          />
        ) : (
          <View style={{ height: BANNER, backgroundColor: colors.banner }} />
        )}
        <View
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            flexDirection: "row",
            gap: 6,
          }}
        >
          <BannerKey icon={DotsThree} label="More" onPress={onMenu} />
          <BannerKey icon={X} label="Close profile" onPress={onDismiss} />
        </View>
        <View
          style={{
            position: "absolute",
            left: 12,
            top: BANNER - AVATAR / 2,
            padding: 4,
            borderRadius: decoration ? 999 : RADIUS,
            backgroundColor: colors.surface,
          }}
        >
          <View
            style={{
              borderRadius: decoration ? 999 : RADIUS,
              overflow: decoration ? "hidden" : "visible",
            }}
          >
            <Avatar
              name={name}
              size={AVATAR}
              uri={mediaUrl(user?.avatar_url ?? person.avatar_url)}
            />
          </View>
          {decoration ? (
            <AvatarDecoration url={decoration} size={AVATAR} />
          ) : null}
          <PresenceNotch
            userId={person.id}
            fallback={user?.status}
            ground={colors.surface}
          />
        </View>
      </View>
      <View style={{ paddingHorizontal: 16, paddingTop: AVATAR / 2 + 12 }}>
        <Text
          variant="display"
          accessibilityRole="header"
          numberOfLines={2}
          style={[
            {
              fontSize: 24,
              lineHeight: 28,
              letterSpacing: -0.5,
              color: colors.ink,
            },
            style ? nameLook(style, colors.surface) : null,
          ]}
        >
          {name}
        </Text>
        <Text
          variant="row"
          numberOfLines={1}
          style={{
            fontSize: 13,
            lineHeight: 18,
            marginTop: 2,
            color: colors.ink2,
          }}
        >
          {handle}
        </Text>
        <StatusLine
          userId={person.id}
          fallbackStatus={user?.status}
          fallbackCustom={user?.custom_status}
          colors={colors}
        />
      </View>
      {relationship === RELATIONSHIP.incoming ? (
        <Notice colors={colors} text="Sent you a friend request" />
      ) : relationship === RELATIONSHIP.blocked ? (
        <Notice colors={colors} text="You blocked them. Unblock from ⋯." />
      ) : null}
      <View
        style={{
          flexDirection: "row",
          gap: 6,
          paddingHorizontal: 16,
          paddingTop: 14,
        }}
      >
        {actions}
      </View>
      {bioBlocks.length > 0 ? (
        <Section title="About me" colors={colors}>
          <Markdown blocks={bioBlocks} />
        </Section>
      ) : null}
      {roles.length > 0 ? (
        <Section title="Roles" colors={colors}>
          <Chips>
            {roles.map((role) => (
              <Chip
                key={role.id}
                label={role.name}
                lead={<RoleDot role={role} />}
              />
            ))}
          </Chips>
        </Section>
      ) : null}
      {profile && profile.mutualServers.count > 0 ? (
        <Section
          title="Mutual servers"
          count={profile.mutualServers.count}
          colors={colors}
        >
          <Chips>
            {profile.mutualServers.items.map((server) => (
              <Chip
                key={server.id}
                label={server.name}
                lead={
                  <Avatar
                    name={server.name}
                    size={20}
                    uri={mediaUrl(server.icon_url)}
                  />
                }
              />
            ))}
          </Chips>
        </Section>
      ) : null}
      {profile && profile.mutualFriends.count > 0 ? (
        <Section
          title="Mutual friends"
          count={profile.mutualFriends.count}
          colors={colors}
        >
          <Chips>
            {profile.mutualFriends.items.map((friend) => (
              <Chip
                key={friend.id}
                label={personName(friend)}
                lead={
                  <Avatar
                    name={personName(friend)}
                    size={20}
                    uri={mediaUrl(friend.avatar_url)}
                  />
                }
                onPress={() => openProfile(friend.id, friend)}
              />
            ))}
          </Chips>
        </Section>
      ) : null}
      {since ? (
        <Section title="Member since" colors={colors}>
          <Text variant="num" style={{ fontSize: 12, color: colors.ink }}>
            {memberSince.format(new Date(since)).toUpperCase()}
          </Text>
        </Section>
      ) : null}
      {!profile && !failed ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 20, gap: 8 }}>
          <Skeleton width={72} height={12} />
          <Skeleton width="80%" height={12} />
          <Skeleton width="60%" height={12} />
        </View>
      ) : null}
      {failed && !profile ? (
        <Text
          variant="row"
          style={{ paddingHorizontal: 16, paddingTop: 20, color: colors.ink2 }}
        >
          The rest of this profile didn't load.
        </Text>
      ) : null}
      {collectibles?.profileEffect ? (
        <ProfileEffect effect={collectibles.profileEffect} width={width} />
      ) : null}
      <ConfirmSheet request={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

function PresenceNotch({
  userId,
  fallback,
  ground,
}: {
  userId: string;
  fallback: string | null | undefined;
  ground: string;
}) {
  const presence = usePresence(userId, fallback);
  const led = presenceLedOf(presence);
  if (!led) return null;
  return (
    <View
      style={{
        position: "absolute",
        right: 0,
        bottom: 0,
        borderWidth: 3,
        borderColor: ground,
        borderRadius: RADIUS,
      }}
    >
      <Led state={led} size={14} />
    </View>
  );
}

function Notice({ colors, text }: { colors: ProfileColors; text: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        marginHorizontal: 16,
        marginTop: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: RADIUS,
        borderWidth: 1,
        borderColor: theme.lineStrong,
        backgroundColor: colors.custom ? "transparent" : theme.ply2,
      }}
    >
      <Text
        variant="row"
        style={{ fontSize: 13, lineHeight: 18, color: colors.ink2 }}
      >
        {text}
      </Text>
    </View>
  );
}

/** A 40px key on the banner, on a dark plate so it reads over any art. */
function BannerKey({
  icon,
  label,
  onPress,
}: {
  icon: typeof X;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({
        width: 40,
        height: 40,
        borderRadius: RADIUS,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed
          ? "rgba(0, 0, 0, 0.72)"
          : "rgba(0, 0, 0, 0.55)",
      })}
    >
      <Icon icon={icon} size={18} color="#f2f2f3" />
    </Pressable>
  );
}

/** The sheet's body for one person, scrolling inside the native sheet. */
function ProfileSheetBody({
  target,
  profile,
  colors,
}: {
  target: ProfileTarget;
  profile: Profile | null;
  colors: ProfileColors;
}) {
  const { width } = useWindowDimensions();
  const failed = useProfileFailed(target.userId);
  const serverId = useContextServerId();
  const sheetScroll = useSheetScroll();
  const [menuFor, setMenuFor] = useState<MenuPerson | null>(null);

  const user = profile?.user;
  const person: Seedish = {
    id: target.userId,
    username: user?.username ?? target.seed?.username ?? "",
    display_name: user?.display_name ?? target.seed?.display_name,
    avatar_url: user?.avatar_url ?? target.seed?.avatar_url,
  };
  const name = personName(person);

  return (
    <>
      <ScrollView
        ref={sheetScroll}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        <ProfileBody
          person={person}
          profile={profile}
          failed={failed}
          serverId={serverId}
          colors={colors}
          width={width}
          onDismiss={closeProfile}
          onMenu={() => setMenuFor({ ...person, name })}
        />
      </ScrollView>
      <PersonMenu
        person={menuFor}
        serverId={serverId}
        onClose={() => setMenuFor(null)}
      />
    </>
  );
}

/**
 * Someone's profile as a bottom sheet over everything: it rises to a first
 * stop (identity and actions, the chat still above it) and drags to full
 * height for the rest; a drag down, a tap on the scrim, the X or Back
 * closes it. At full height the body scrolls, and pulling down from its top
 * drags the sheet. A theme's background tints the sheet.
 */
export function UserProfileSheet({ target }: { target: ProfileTarget | null }) {
  const theme = useTheme();
  // The last person stays on the sheet while it sinks.
  const [shown, setShown] = useState(target);
  if (target && target !== shown) setShown(target);
  const profile = useProfile(shown?.userId ?? "");
  const user = profile?.user;
  const colors = profileColors(user ?? {}, theme);
  const name = personName({
    username: user?.username ?? shown?.seed?.username ?? "",
    display_name: user?.display_name ?? shown?.seed?.display_name,
  });

  return (
    <Sheet
      visible={target !== null}
      onClose={closeProfile}
      label={`${name}'s profile`}
      expandable
      fill
      flush
      surface={colors.surface}
      grabberColor="rgba(242, 242, 243, 0.6)"
    >
      {shown ? (
        <ProfileSheetBody
          key={shown.userId}
          target={shown}
          profile={profile}
          colors={colors}
        />
      ) : null}
    </Sheet>
  );
}
