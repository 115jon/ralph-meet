import { ChatCircle } from "phosphor-react-native";
import { memo, type ReactNode } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";

import { useServerMentionCount } from "@/features/activity/store";
import { useUnreadDmCount } from "@/features/dms/store";
import { usePlateClearance } from "@/features/panel/metrics";
import type { Server } from "@/features/servers/schema";
import { serverInitials } from "@/features/servers/initials";
import {
  useServerHasUnread,
  useServerList,
  useServersStore,
} from "@/features/servers/store";
import { mediaUrl } from "@/lib/api";
import { FONT, RADIUS, type Theme, useTheme } from "@/theme";
import { CountChip, Icon, Skeleton, Text } from "@/ui";

import { showDms, showServer, useHomePane } from "./pane";

const RAIL_WIDTH = 68;
const TILE = 48;

type Pill = "selected" | "unread" | "none";

/**
 * One rail row: the tile, its pill flush with the rail's left edge (24px
 * selected, 8px unread, as the web's rail) and a count chip on the tile's
 * bottom-right corner.
 */
function RailSlot({
  pill,
  count,
  children,
}: {
  pill: Pill;
  count: number;
  children: ReactNode;
}) {
  const theme = useTheme();
  return (
    <View style={{ width: RAIL_WIDTH, alignItems: "center" }}>
      {pill === "none" ? null : (
        <View
          style={{
            position: "absolute",
            left: 0,
            top: (TILE - (pill === "selected" ? 24 : 8)) / 2,
            width: 3,
            height: pill === "selected" ? 24 : 8,
            backgroundColor: theme.ink1,
          }}
        />
      )}
      <View>
        {children}
        {count > 0 ? (
          <View
            pointerEvents="none"
            style={{ position: "absolute", right: -6, bottom: -6 }}
          >
            <CountChip count={count} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function tileStyle(theme: Theme, selected: boolean, pressed: boolean) {
  return {
    width: TILE,
    height: TILE,
    borderRadius: RADIUS,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: selected ? theme.primaryFill : theme.ply2,
    borderWidth: 1,
    borderColor: selected ? theme.primaryFill : theme.line,
    opacity: pressed ? 0.86 : 1,
  } as const;
}

/** Direct messages, at the top of the rail as on Discord. */
function DmsKey() {
  const theme = useTheme();
  const selected = useHomePane() === "dms";
  const unread = useUnreadDmCount();
  return (
    <RailSlot pill={selected ? "selected" : "none"} count={unread}>
      <Pressable
        accessibilityRole="tab"
        accessibilityLabel={
          unread > 0 ? `Direct messages, ${unread} unread` : "Direct messages"
        }
        accessibilityState={{ selected }}
        onPress={showDms}
        style={({ pressed }) => tileStyle(theme, selected, pressed)}
      >
        <Icon
          icon={ChatCircle}
          active={selected}
          size={24}
          color={selected ? theme.onPrimary : theme.ink2}
        />
      </Pressable>
    </RailSlot>
  );
}

const ServerTile = memo(function ServerTile({
  server,
  selected,
}: {
  server: Server;
  selected: boolean;
}) {
  const theme = useTheme();
  const unread = useServerHasUnread(server.id);
  const mentions = useServerMentionCount(server.id);
  const icon = mediaUrl(server.icon_url);
  const pill: Pill = selected ? "selected" : unread ? "unread" : "none";
  const label = [
    server.name,
    mentions > 0 ? `${mentions} mentions` : null,
    !selected && unread ? "unread" : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <RailSlot pill={pill} count={mentions}>
      <Pressable
        accessibilityRole="tab"
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        onPress={() => showServer(server.id)}
        style={({ pressed }) => tileStyle(theme, selected, pressed)}
      >
        {icon ? (
          <Image
            source={{ uri: icon }}
            accessibilityIgnoresInvertColors
            style={{
              width: selected ? TILE - 6 : TILE - 2,
              height: selected ? TILE - 6 : TILE - 2,
              borderRadius: RADIUS - 1,
            }}
          />
        ) : (
          <Text
            variant="name"
            maxFontSizeMultiplier={1}
            style={{
              fontFamily: FONT.display,
              fontSize: 16,
              color: selected ? theme.onPrimary : theme.ink1,
            }}
          >
            {serverInitials(server.name)}
          </Text>
        )}
      </Pressable>
    </RailSlot>
  );
});

/** The 2px by 24px ink rule dividing direct messages from servers. */
function RailRule() {
  const theme = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: 24, height: 2, backgroundColor: theme.ink1 }}
    />
  );
}

/**
 * The vertical server rail: direct messages, the rule, then a tile per
 * server. It scrolls under the panel, padded so the last tile clears it.
 */
export function Rail() {
  const theme = useTheme();
  const clearance = usePlateClearance();
  const { servers, status } = useServerList();
  const pane = useHomePane();
  const selectedId = useServersStore((s) => s.selectedId);
  return (
    <ScrollView
      accessibilityRole="tablist"
      showsVerticalScrollIndicator={false}
      style={{
        width: RAIL_WIDTH,
        flexGrow: 0,
        borderRightWidth: 1,
        borderRightColor: theme.line,
      }}
      contentContainerStyle={{
        alignItems: "center",
        gap: 10,
        paddingTop: 8,
        paddingBottom: clearance,
      }}
    >
      <DmsKey />
      <RailRule />
      {servers.length === 0 && status === "loading"
        ? [0, 1, 2].map((i) => <Skeleton key={i} width={TILE} height={TILE} />)
        : servers.map((server) => (
            <ServerTile
              key={server.id}
              server={server}
              selected={pane === "server" && server.id === selectedId}
            />
          ))}
    </ScrollView>
  );
}
