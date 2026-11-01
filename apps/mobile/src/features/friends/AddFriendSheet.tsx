import { X } from "phosphor-react-native";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { FONT, RADIUS, useTheme } from "@/theme";
import { Button, Icon, Sheet, Text } from "@/ui";

import { sendFriendRequest } from "./actions";

function Body({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const ready = username.trim().length > 0 && !sending;

  const submit = async () => {
    if (!ready) return;
    setSending(true);
    setError(null);
    const outcome = await sendFriendRequest(username);
    setSending(false);
    if (outcome.ok) onClose();
    else setError(outcome.error);
  };

  return (
    <View style={{ paddingHorizontal: 16, gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="silk" tone="ink3">
            Friends
          </Text>
          <Text
            variant="display"
            accessibilityRole="header"
            style={{ fontSize: 22, lineHeight: 26, letterSpacing: -0.4 }}
          >
            Add friend
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: RADIUS,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? theme.tint3 : theme.tint2,
          })}
        >
          <Icon icon={X} size={18} />
        </Pressable>
      </View>
      {/* DESIGN's legend plate: the label printed across the top edge. */}
      <View style={{ paddingTop: 7 }}>
        <View
          style={{
            height: 52,
            justifyContent: "center",
            borderRadius: RADIUS,
            borderWidth: 1,
            borderColor: error ? theme.dangerInk : theme.ink1,
            backgroundColor: theme.ply2,
          }}
        >
          <TextInput
            value={username}
            onChangeText={(next) => {
              setUsername(next);
              if (error) setError(null);
            }}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            returnKeyType="send"
            onSubmitEditing={() => void submit()}
            accessibilityLabel="Username"
            accessibilityHint="Usernames are exact"
            placeholder="their username"
            placeholderTextColor={theme.ink3}
            cursorColor={theme.accentInk}
            selectionColor={theme.accentTint}
            style={{
              height: 50,
              paddingHorizontal: 12,
              fontFamily: FONT.body,
              fontSize: 15,
              color: theme.ink1,
            }}
          />
        </View>
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 8,
            paddingHorizontal: 4,
            backgroundColor: theme.ply3,
          }}
        >
          <Text variant="silk" tone={error ? "ink1" : "ink2"}>
            Username
          </Text>
        </View>
      </View>
      <Text
        variant="row"
        accessibilityLiveRegion="polite"
        style={{
          fontSize: 12.5,
          lineHeight: 16,
          color: error ? theme.dangerInk : theme.ink2,
        }}
      >
        {error ?? "Usernames are exact. Ask them for theirs."}
      </Text>
      <View style={{ opacity: ready ? 1 : 0.45 }}>
        <Button
          label={sending ? "Sending…" : "Send request"}
          onPress={() => void submit()}
        />
      </View>
    </View>
  );
}

/** Add a friend by exact username (POST /api/friends), riding the keyboard. */
export function AddFriendSheet({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} onClose={onClose} label="Add friend">
      {visible ? <Body onClose={onClose} /> : null}
    </Sheet>
  );
}
