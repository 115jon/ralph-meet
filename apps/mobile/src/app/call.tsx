import { useRouter } from "expo-router";
import { CaretDown } from "phosphor-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { callLed, callStatusLabel } from "@/features/panel/call-row";
import { stopScreenShare } from "@/features/voice/actions";
import { CallDock } from "@/features/voice/CallDock";
import { ParticipantTile } from "@/features/voice/ParticipantTile";
import {
  type CallTile,
  useCallSummary,
  useCallTiles,
} from "@/features/voice/store";
import { useWatchCallVideo } from "@/features/voice/use-watch-video";
import { RADIUS, useTheme } from "@/theme";
import { IconButton, Led, Text } from "@/ui";

/** Two tiles a row; an odd one out spans the first row. */
function rowsOf<T>(items: readonly T[]): T[][] {
  const rows: T[][] = [];
  let index = 0;
  if (items.length % 2 === 1) {
    rows.push(items.slice(0, 1));
    index = 1;
  }
  for (; index < items.length; index += 2) {
    rows.push(items.slice(index, index + 2));
  }
  return rows;
}

const FILMSTRIP_HEIGHT = 96;

/**
 * While our screen is shared: a live LED, the plain fact, and Stop. Android
 * adds its own status bar chip; this one is where the call is.
 */
function SharingBanner() {
  const theme = useTheme();
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        marginHorizontal: 12,
        marginTop: 4,
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 6,
        paddingLeft: 12,
        paddingRight: 6,
        borderRadius: RADIUS,
        backgroundColor: theme.ply2,
        borderWidth: 1,
        borderColor: theme.line,
      }}
    >
      <Led state="live" />
      <Text variant="row" numberOfLines={1} style={{ flex: 1 }}>
        You&apos;re sharing your screen
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Stop sharing your screen"
        onPress={stopScreenShare}
        style={({ pressed }) => ({
          height: 36,
          paddingHorizontal: 14,
          borderRadius: RADIUS,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: pressed ? theme.tint3 : theme.tint1,
        })}
      >
        <Text variant="control">Stop</Text>
      </Pressable>
    </View>
  );
}

interface StageProps {
  staged: CallTile;
  others: readonly CallTile[];
  onPress: (tile: CallTile) => void;
}

/** One tile large; the rest in a filmstrip below it. */
function Stage({ staged, others, onPress }: StageProps) {
  return (
    <View style={{ flex: 1, gap: 8, paddingHorizontal: 12, paddingTop: 8 }}>
      <ParticipantTile tile={staged} staged onPress={onPress} />
      {others.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, height: FILMSTRIP_HEIGHT }}
          contentContainerStyle={{ gap: 8 }}
        >
          {others.map((tile) => (
            <ParticipantTile
              key={tile.key}
              tile={tile}
              compact
              onPress={onPress}
              style={{ flex: 0, width: 128, height: FILMSTRIP_HEIGHT }}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

/**
 * The call: tiles fill the height between the header and the dock. Tapping a
 * tile puts it on the stage (a shared screen is easiest to read there);
 * tapping it again returns to the grid. Video is pulled only while this
 * screen is visible.
 */
export default function CallScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const call = useCallSummary();
  const tiles = useCallTiles();
  const inCall = call !== null;
  const [stagedKey, setStagedKey] = useState<string | null>(null);
  // A staged tile that went away (they left, the share ended) leaves the grid.
  const staged = tiles.find((tile) => tile.key === stagedKey) ?? null;
  const toggleStage = useCallback(
    (tile: CallTile) =>
      setStagedKey((current) => (current === tile.key ? null : tile.key)),
    [],
  );
  useWatchCallVideo();

  // Leaving (here or from the panel) or a failed join closes the screen.
  useEffect(() => {
    if (inCall) return;
    if (router.canGoBack()) router.back();
    else router.replace("/home");
  }, [inCall, router]);

  if (!call) return null;
  const led = callLed(call);

  return (
    <View
      style={{ flex: 1, backgroundColor: theme.ply0, paddingTop: insets.top }}
    >
      <View
        style={{
          height: 56,
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingLeft: 4,
          paddingRight: 16,
        }}
      >
        <IconButton
          icon={CaretDown}
          label="Minimise the call"
          onPress={() => router.back()}
        />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            variant="title"
            numberOfLines={1}
            accessibilityRole="header"
            style={{ fontSize: 18, lineHeight: 22 }}
          >
            {call.channelName}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Led state={led} />
            <Text
              variant="silk"
              numberOfLines={1}
              style={{ color: led === "talk" ? theme.talk : theme.ink2 }}
            >
              {callStatusLabel(call)}
            </Text>
            {call.count > 0 ? (
              <Text variant="num" tone="ink3">
                {call.count}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
      {call.sharing ? <SharingBanner /> : null}
      {staged ? (
        <Stage
          staged={staged}
          others={tiles.filter((tile) => tile !== staged)}
          onPress={toggleStage}
        />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            flexGrow: 1,
            gap: 8,
            paddingHorizontal: 12,
            paddingTop: 8,
            paddingBottom: 12,
          }}
        >
          {tiles.length === 0 ? (
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text variant="body" tone="ink3">
                Connecting to {call.channelName}
              </Text>
            </View>
          ) : null}
          {rowsOf(tiles).map((row) => (
            <View
              key={row.map((tile) => tile.key).join("|")}
              style={{ flex: 1, minHeight: 140, flexDirection: "row", gap: 8 }}
            >
              {row.map((tile) => (
                <ParticipantTile
                  key={tile.key}
                  tile={tile}
                  onPress={toggleStage}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      )}
      <CallDock
        muted={call.muted}
        deafened={call.deafened}
        camera={call.camera}
        sharing={call.sharing}
        bottomInset={insets.bottom}
      />
    </View>
  );
}
