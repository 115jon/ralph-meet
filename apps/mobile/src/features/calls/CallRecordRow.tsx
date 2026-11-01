import { describeCallRecord, type CallRecord } from "@ralph/protocol";
import { Phone, PhoneSlash } from "phosphor-react-native";
import { memo } from "react";
import { Pressable, View } from "react-native";

import { useSession } from "@/features/auth/session";
import { authorName } from "@/features/chat/authors";
import type { ChatMessage } from "@/features/chat/store";
import { formatTime } from "@/features/chat/time";
import { useDm } from "@/features/dms/store";
import { RADIUS, useTheme } from "@/theme";
import { Icon, Text } from "@/ui";

import { requestCallBack } from "./actions";

/**
 * A DM call record in the timeline: a system row, not a bubble. A missed
 * call takes the danger glyph and a small "Call back" key; an ended call
 * shows its length in the number face.
 */
export const CallRecordRow = memo(function CallRecordRow({
  message,
  call,
  sentAt,
}: {
  message: ChatMessage;
  call: CallRecord;
  sentAt: Date;
}) {
  const theme = useTheme();
  const myId = useSession((s) => s.user?.id);
  const dm = useDm(message.channel_id);
  const other = dm?.recipient;
  const callerName = message.author ? authorName(message.author) : "Someone";
  const calleeName =
    other && other.id === call.callee_id ? authorName(other) : "them";
  const line = describeCallRecord(call, myId, { callerName, calleeName });
  const missed = line.tone === "missed";
  const time = formatTime(sentAt);

  return (
    <View
      accessible
      accessibilityLabel={`${line.text}${line.duration ? `, ${line.duration}` : ""}, ${time}`}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        minHeight: 44,
        paddingHorizontal: 16,
        paddingVertical: 6,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: RADIUS,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: missed ? theme.dangerTint : theme.tint1,
        }}
      >
        <Icon
          icon={missed ? PhoneSlash : Phone}
          active
          size={16}
          color={missed ? theme.dangerInk : theme.ink2}
        />
      </View>
      <View
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: "row",
          alignItems: "baseline",
          flexWrap: "wrap",
          columnGap: 6,
        }}
      >
        <Text
          variant="row"
          style={{ color: missed ? theme.dangerInk : theme.ink2 }}
        >
          {line.text}
        </Text>
        {line.duration ? (
          <Text variant="num" tone="ink2">
            {line.duration}
          </Text>
        ) : null}
        <Text variant="num" tone="ink3">
          {time}
        </Text>
      </View>
      {missed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Call ${callerName} back`}
          onPress={() => requestCallBack(message.channel_id)}
          hitSlop={4}
          style={({ pressed }) => ({
            height: 32,
            paddingHorizontal: 12,
            borderRadius: RADIUS,
            justifyContent: "center",
            borderWidth: 1,
            borderColor: theme.lineStrong,
            backgroundColor: pressed ? theme.tint2 : "transparent",
          })}
        >
          <Text variant="control" style={{ fontSize: 13, lineHeight: 16 }}>
            Call back
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
});
