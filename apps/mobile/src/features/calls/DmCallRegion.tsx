import { router } from "expo-router";
import { ArrowsOutSimple, PhoneX } from "phosphor-react-native";
import { Pressable, View } from "react-native";

import { useSession } from "@/features/auth/session";
import { authorName } from "@/features/chat/authors";
import { useIsUserSpeaking, useVoiceStore } from "@/features/voice/store";
import { mediaUrl } from "@/lib/api";
import { RADIUS, useTheme } from "@/theme";
import { Avatar, Icon, IconButton, Led, Text, type LedState } from "@/ui";

import { hangUp, ringAgain } from "./actions";
import { CallClock, RingPulse } from "./RingPulse";
import { useCallsStore, useOutgoingRing, type CallPeer } from "./store";

const AVATAR = 48;

/** One person in the region: the same plate as the call's tiles, smaller. */
function RegionTile({
  userId,
  name,
  avatarUrl,
  ringing = false,
  dimmed = false,
  onPress,
}: {
  userId: string;
  name: string;
  avatarUrl: string | null;
  ringing?: boolean;
  dimmed?: boolean;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const speaking = useIsUserSpeaking(userId);
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={onPress ? `${name}. Opens the call` : name}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        borderRadius: RADIUS,
        borderWidth: speaking ? 2 : 1,
        borderColor: speaking ? theme.talk : theme.line,
        borderStyle: dimmed ? "dashed" : "solid",
        backgroundColor: pressed ? theme.ply3 : theme.ply2,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      })}
    >
      <View style={{ opacity: dimmed ? 0.45 : 1 }}>
        <RingPulse size={AVATAR} ringing={ringing}>
          <Avatar name={name} uri={mediaUrl(avatarUrl)} size={AVATAR} />
        </RingPulse>
      </View>
      <View
        style={{
          position: "absolute",
          left: 6,
          bottom: 6,
          right: 6,
          flexDirection: "row",
        }}
      >
        <View
          style={{
            height: 20,
            maxWidth: "100%",
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 6,
            borderRadius: RADIUS,
            backgroundColor: theme.ply4,
          }}
        >
          <Led state={speaking ? "talk" : "off"} size={6} />
          <Text
            variant="name"
            numberOfLines={1}
            style={{ fontSize: 12, lineHeight: 16, flexShrink: 1 }}
          >
            {name}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

interface RegionStatus {
  readonly led: LedState;
  readonly label: string;
  /** The clock: from the ring, or from when they connected. */
  readonly since: number | null;
}

/**
 * The DM's call above the chat, as the web's DMCallRegion: you and them as
 * tiles, the call's state as a lit word with a clock, and its keys. It is
 * here while we ring them, after "No answer" (we stay in the call to ring
 * again), and while we're in the DM's call. Tapping a tile opens /call.
 */
export function DmCallRegion({
  channelId,
  peer,
}: {
  channelId: string;
  peer: CallPeer;
}) {
  const theme = useTheme();
  const me = useSession((s) => s.user);
  const outgoing = useOutgoingRing(channelId);
  const callStatus = useVoiceStore((s) =>
    s.call?.channelId === channelId ? s.call.status : null,
  );
  const peerHere = useVoiceStore(
    (s) =>
      s.call?.channelId === channelId &&
      Object.values(s.call.participants).some((p) => p.userId === peer.id),
  );
  const connectedSince = useCallsStore((s) => s.connectedAt);

  const inCall = callStatus !== null;
  if (!me || (!outgoing && !inCall)) return null;

  const ringing =
    outgoing?.phase === "ringing" || outgoing?.phase === "starting";
  const unanswered =
    outgoing?.phase === "no-answer" || outgoing?.phase === "declined";
  let status: RegionStatus;
  if (peerHere && connectedSince !== null) {
    status = { led: "talk", label: "Connected", since: connectedSince };
  } else if (outgoing && ringing) {
    status = {
      led: "idle",
      label: outgoing.phase === "starting" ? "Calling" : "Ringing",
      since: outgoing.phase === "ringing" ? outgoing.since : null,
    };
  } else if (outgoing?.phase === "declined") {
    status = { led: "off", label: "Declined", since: null };
  } else if (outgoing?.phase === "no-answer") {
    status = { led: "off", label: "No answer", since: null };
  } else if (callStatus === "connected") {
    status = { led: "idle", label: `Waiting for ${peer.name}`, since: null };
  } else {
    status = {
      led: "idle",
      label: callStatus === "reconnecting" ? "Reconnecting" : "Joining",
      since: null,
    };
  }
  const openCall = inCall ? () => router.push("/call") : undefined;

  return (
    <View
      style={{
        paddingHorizontal: 12,
        paddingTop: 10,
        paddingBottom: 10,
        gap: 10,
        backgroundColor: theme.ply1,
        borderBottomWidth: 1,
        borderBottomColor: theme.line,
      }}
    >
      <View style={{ height: 112, flexDirection: "row", gap: 8 }}>
        <RegionTile
          userId={me.id}
          name={`${authorName(me)} (you)`}
          avatarUrl={me.avatar_url ?? null}
          onPress={openCall}
        />
        <RegionTile
          userId={peer.id}
          name={peer.name}
          avatarUrl={peer.avatarUrl}
          ringing={ringing && !peerHere}
          dimmed={unanswered && !peerHere}
          onPress={openCall}
        />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View
          accessibilityLiveRegion="polite"
          style={{
            flex: 1,
            minWidth: 0,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Led state={status.led} />
          <Text
            variant="silk"
            numberOfLines={1}
            style={{
              flexShrink: 1,
              color: status.led === "talk" ? theme.talk : theme.ink2,
            }}
          >
            {status.label}
          </Text>
          {status.since !== null ? (
            <CallClock
              since={status.since}
              color={status.led === "talk" ? theme.talk : theme.ink2}
            />
          ) : null}
        </View>
        {unanswered ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => ringAgain(channelId)}
            style={({ pressed }) => ({
              height: 40,
              paddingHorizontal: 14,
              borderRadius: RADIUS,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? theme.tint3 : theme.tint1,
            })}
          >
            <Text variant="control">Ring again</Text>
          </Pressable>
        ) : null}
        {openCall ? (
          <IconButton
            icon={ArrowsOutSimple}
            label="Open the call"
            onPress={openCall}
          />
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={ringing ? "Cancel the call" : "Leave the call"}
          onPress={() => hangUp(channelId)}
          hitSlop={4}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: RADIUS,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.dangerFill,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Icon icon={PhoneX} active size={20} color={theme.onDanger} />
        </Pressable>
      </View>
    </View>
  );
}
