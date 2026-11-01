import { Phone } from "phosphor-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import {
  setCallPreference,
  useCallPreferences,
} from "@/features/preferences/call-preferences";
import { mediaUrl } from "@/lib/api";
import { RADIUS, useTheme } from "@/theme";
import { Avatar, Button, Icon, Sheet, SwitchKey, Text } from "@/ui";

import type { CallPeer } from "./store";

/**
 * "Call them?" before a DM call rings every device they're signed in on,
 * as the web's StartCallModal asks, with its "Don't ask again". While in
 * another call it always asks, and says which call you'd leave.
 */
export function CallConfirmSheet({
  peer,
  leaving,
  onCancel,
  onCall,
}: {
  /** Who would be called; null hides the sheet. */
  peer: CallPeer | null;
  /** The call you're in now, e.g. "General"; null when none. */
  leaving: string | null;
  onCancel: () => void;
  onCall: () => void;
}) {
  return (
    <Sheet
      visible={peer !== null}
      onClose={onCancel}
      label={peer ? `Call ${peer.name}?` : "Call"}
    >
      {peer ? (
        <ConfirmBody
          peer={peer}
          leaving={leaving}
          onCancel={onCancel}
          onCall={onCall}
        />
      ) : null}
    </Sheet>
  );
}

function ConfirmBody({
  peer,
  leaving,
  onCancel,
  onCall,
}: {
  peer: CallPeer;
  leaving: string | null;
  onCancel: () => void;
  onCall: () => void;
}) {
  const theme = useTheme();
  const skip = useCallPreferences((s) => s.skipCallConfirm);
  const [dontAsk, setDontAsk] = useState(skip);
  const call = () => {
    if (dontAsk !== skip) setCallPreference("skipCallConfirm", dontAsk);
    onCall();
  };
  return (
    <View style={{ paddingHorizontal: 16, gap: 12 }}>
      <View style={{ alignItems: "center", gap: 10, paddingTop: 4 }}>
        <Avatar name={peer.name} uri={mediaUrl(peer.avatarUrl)} size={64} />
        <Text
          variant="display"
          accessibilityRole="header"
          numberOfLines={1}
          style={{ fontSize: 22, lineHeight: 26, letterSpacing: -0.4 }}
        >
          {`Call ${peer.name}?`}
        </Text>
        <Text variant="body" tone="ink2" style={{ textAlign: "center" }}>
          {leaving
            ? `They'll ring on every device they're signed in on. You'll leave ${leaving}.`
            : "They'll ring on every device they're signed in on."}
        </Text>
      </View>
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: dontAsk }}
        accessibilityLabel="Don't ask again"
        onPress={() => setDontAsk((value) => !value)}
        style={({ pressed }) => ({
          minHeight: 48,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 4,
          borderRadius: RADIUS,
          backgroundColor: pressed ? theme.tint2 : "transparent",
        })}
      >
        <Text variant="row" style={{ flex: 1, fontSize: 15 }}>
          Don&apos;t ask again
        </Text>
        <SwitchKey on={dontAsk} />
      </Pressable>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button variant="ghost" label="Cancel" onPress={onCancel} />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Call ${peer.name}`}
          onPress={call}
          style={({ pressed }) => ({
            flex: 1,
            height: 48,
            borderRadius: RADIUS,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            backgroundColor: theme.talk,
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Icon icon={Phone} active size={20} color={theme.onTalk} />
          <Text variant="control" style={{ color: theme.onTalk }}>
            Call
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
