import { useRouter } from "expo-router";
import { CaretDown } from "phosphor-react-native";
import { useEffect } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { callLed } from "@/features/app-bar/call-segment";
import { CallDock } from "@/features/voice/CallDock";
import { ParticipantTile } from "@/features/voice/ParticipantTile";
import {
  useCallSummary,
  useParticipantIds,
  type CallStatus,
} from "@/features/voice/store";
import { useTheme } from "@/theme";
import { IconButton, Led, Text } from "@/ui";

const STATUS_LABEL: Record<CallStatus, string> = {
  joining: "Joining",
  connected: "Connected",
  reconnecting: "Reconnecting",
};

/** Two tiles a row; an odd one out spans the first row. */
function rowsOf(ids: readonly string[]): string[][] {
  const rows: string[][] = [];
  let index = 0;
  if (ids.length % 2 === 1) {
    rows.push([ids[0] ?? ""]);
    index = 1;
  }
  for (; index < ids.length; index += 2) {
    rows.push(ids.slice(index, index + 2));
  }
  return rows;
}

/** The call: participants fill the height between the header and the dock. */
export default function CallScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const call = useCallSummary();
  const ids = useParticipantIds();
  const inCall = call !== null;

  // Leaving (here or from the bar) or a failed join closes the screen.
  useEffect(() => {
    if (inCall) return;
    if (router.canGoBack()) router.back();
    else router.replace("/servers");
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
              style={{ color: led === "talk" ? theme.talk : theme.ink2 }}
            >
              {STATUS_LABEL[call.status]}
            </Text>
            {call.count > 0 ? (
              <Text variant="num" tone="ink3">
                {call.count}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
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
        {ids.length === 0 ? (
          <View
            style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
          >
            <Text variant="body" tone="ink3">
              Connecting to {call.channelName}
            </Text>
          </View>
        ) : null}
        {rowsOf(ids).map((row) => (
          <View
            key={row.join(":")}
            style={{ flex: 1, minHeight: 140, flexDirection: "row", gap: 8 }}
          >
            {row.map((id) => (
              <ParticipantTile key={id} id={id} />
            ))}
          </View>
        ))}
      </ScrollView>
      <CallDock
        muted={call.muted}
        deafened={call.deafened}
        bottomInset={insets.bottom}
      />
    </View>
  );
}
