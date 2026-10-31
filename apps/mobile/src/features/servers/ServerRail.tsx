import { memo, useCallback } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";

import { mediaUrl } from "@/lib/api";
import { FONT, RADIUS, useTheme } from "@/theme";
import { Skeleton, Text } from "@/ui";

import { selectServer } from "./actions";
import type { Server } from "./schema";
import { useServersStore } from "./store";

const TILE = 48;

/** "Ralph HQ" → "RH", "valorant" → "VA". */
function serverInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    words.length > 1
      ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`
      : name.trim().slice(0, 2);
  return letters.toUpperCase();
}

interface TileProps {
  server: Server;
  selected: boolean;
  onSelect: (id: string) => void;
}

const ServerTile = memo(function ServerTile({
  server,
  selected,
  onSelect,
}: TileProps) {
  const theme = useTheme();
  const icon = mediaUrl(server.icon_url);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={server.name}
      accessibilityState={{ selected }}
      onPress={() => onSelect(server.id)}
      style={({ pressed }) => ({
        width: TILE,
        height: TILE,
        borderRadius: RADIUS,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: selected ? theme.primaryFill : theme.ply2,
        borderWidth: 1,
        borderColor: selected ? theme.primaryFill : theme.line,
        opacity: pressed ? 0.86 : 1,
      })}
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
          style={{
            fontFamily: FONT.display,
            fontSize: 16,
            color: selected ? theme.onPrimary : theme.ink1,
          }}
        >
          {serverInitials(server.name)}
        </Text>
      )}
      {selected ? (
        <View
          style={{
            position: "absolute",
            bottom: -8,
            width: 8,
            height: 2,
            backgroundColor: theme.ink1,
          }}
        />
      ) : null}
    </Pressable>
  );
});

/** Square server tiles; the selected one is the primary fill with a mark under it. */
export function ServerRail({ servers }: { servers: readonly Server[] }) {
  const selectedId = useServersStore((s) => s.selectedId);
  const onSelect = useCallback((id: string) => selectServer(id), []);
  return (
    <ScrollView
      horizontal
      accessibilityRole="tablist"
      showsHorizontalScrollIndicator={false}
      style={{ flexGrow: 0 }}
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 16,
        gap: 8,
      }}
    >
      {servers.map((server) => (
        <ServerTile
          key={server.id}
          server={server}
          selected={server.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </ScrollView>
  );
}

export function ServerRailSkeleton() {
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 8,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 16,
      }}
    >
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} width={TILE} height={TILE} />
      ))}
    </View>
  );
}
