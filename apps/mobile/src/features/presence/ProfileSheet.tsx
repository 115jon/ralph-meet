import { useRouter } from "expo-router";
import { Check, GearSix } from "phosphor-react-native";
import { type ReactNode, useState } from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";

import { useSession } from "@/features/auth/session";
import { mediaUrl } from "@/lib/api";
import { FONT, RADIUS, useTheme } from "@/theme";
import {
  Avatar,
  Button,
  Icon,
  Led,
  RemoteImage,
  Sheet,
  SheetRow,
  Text,
} from "@/ui";

import { setCustomStatus, setStatus } from "./actions";
import {
  CUSTOM_STATUS_MAX,
  STATUS_HINT,
  STATUS_LABEL,
  statusLed,
  USER_STATUSES,
  type UserStatus,
} from "./status";
import { useSelfCustomStatus, useSelfStatus } from "./use-self-presence";

const BANNER_HEIGHT = 96;
const AVATAR = 64;

/** A silkscreen label over its rows, on the sheet's 16px edge. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text
        variant="silk"
        tone="ink3"
        numberOfLines={1}
        accessibilityRole="header"
        style={{ paddingHorizontal: 16 }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

/** Banner (a still image, when the profile has one), avatar, name, handle. */
function Identity() {
  const theme = useTheme();
  const user = useSession((s) => s.user);
  const status = useSelfStatus();
  if (!user) return null;
  const name = user.display_name ?? user.username;
  // A video banner has no still frame to show here.
  const banner =
    user.banner_url && !user.banner_content_type?.startsWith("video/")
      ? user.banner_url
      : null;
  return (
    <View style={{ paddingHorizontal: 16 }}>
      {banner ? (
        <RemoteImage
          url={banner}
          style={{
            height: BANNER_HEIGHT,
            borderRadius: RADIUS,
            backgroundColor: theme.ply2,
          }}
        />
      ) : null}
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 12,
          marginTop: banner ? -AVATAR / 2 : 4,
          paddingLeft: banner ? 12 : 0,
        }}
      >
        <View
          style={{
            borderWidth: banner ? 3 : 0,
            borderColor: theme.ply3,
            borderRadius: RADIUS,
          }}
        >
          <Avatar
            name={name}
            size={AVATAR}
            uri={mediaUrl(user.avatar_url)}
            presence={statusLed(status)}
            presenceGround={theme.ply3}
          />
        </View>
        <View style={{ flex: 1, minWidth: 0, paddingBottom: 2 }}>
          <Text variant="title" numberOfLines={1} accessibilityRole="header">
            {name}
          </Text>
          <Text variant="row" tone="ink3" numberOfLines={1}>
            @{user.username}
          </Text>
        </View>
      </View>
    </View>
  );
}

/** One status: its LED, name and hint; the chosen one is tinted and checked. */
function StatusRow({
  status,
  selected,
  onPress,
}: {
  status: UserStatus;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const hint = STATUS_HINT[status];
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={STATUS_LABEL[status]}
      accessibilityHint={hint}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: selected || pressed ? theme.tint2 : "transparent",
      })}
    >
      <Led state={statusLed(status)} size={10} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="row" style={{ fontSize: 15, lineHeight: 20 }}>
          {STATUS_LABEL[status]}
        </Text>
        {hint ? (
          <Text
            variant="row"
            tone="ink3"
            style={{ fontSize: 13, lineHeight: 18 }}
          >
            {hint}
          </Text>
        ) : null}
      </View>
      {selected ? <Icon icon={Check} size={18} color={theme.ink1} /> : null}
    </Pressable>
  );
}

function StatusPicker() {
  const status = useSelfStatus();
  return (
    <Section title="Status">
      <View accessibilityRole="radiogroup">
        {USER_STATUSES.map((option) => (
          <StatusRow
            key={option}
            status={option}
            selected={option === status}
            onPress={() => void setStatus(option)}
          />
        ))}
      </View>
    </Section>
  );
}

/** A field plate for the custom status, with Save and, when one is set, Clear. */
function CustomStatusField() {
  const theme = useTheme();
  const saved = useSelfCustomStatus();
  const [value, setValue] = useState(saved ?? "");
  // Follows a change made elsewhere (another device) while the sheet is up.
  const [shown, setShown] = useState(saved);
  if (shown !== saved) {
    setShown(saved);
    setValue(saved ?? "");
  }
  const dirty = value.trim() !== (saved ?? "");
  const save = (text: string) => {
    Keyboard.dismiss();
    void setCustomStatus(text);
  };

  return (
    <Section title="Custom status">
      <View style={{ gap: 8, paddingHorizontal: 16 }}>
        <TextInput
          value={value}
          onChangeText={setValue}
          maxLength={CUSTOM_STATUS_MAX}
          returnKeyType="done"
          onSubmitEditing={() => {
            if (dirty) save(value);
          }}
          accessibilityLabel="Custom status"
          placeholder="Set a custom status"
          placeholderTextColor={theme.ink3}
          cursorColor={theme.accentInk}
          selectionColor={theme.accentTint}
          style={{
            height: 48,
            paddingHorizontal: 12,
            borderRadius: RADIUS,
            borderWidth: 1,
            borderColor: theme.lineField,
            backgroundColor: theme.ply2,
            fontFamily: FONT.body,
            fontSize: 15,
            color: theme.ink1,
          }}
        />
        <View
          style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}
        >
          {saved ? (
            <Button
              variant="ghost"
              label="Clear"
              onPress={() => {
                setValue("");
                save("");
              }}
            />
          ) : null}
          {dirty ? <Button label="Save" onPress={() => save(value)} /> : null}
        </View>
      </View>
    </Section>
  );
}

interface ProfileSheetProps {
  visible: boolean;
  onClose: () => void;
}

/** Opened from the panel's avatar: who you are, your status, settings. */
export function ProfileSheet({ visible, onClose }: ProfileSheetProps) {
  const router = useRouter();
  const { height } = useWindowDimensions();
  return (
    <Sheet visible={visible} onClose={onClose} label="Profile and status">
      <ScrollView
        style={{ maxHeight: height * 0.85 }}
        contentContainerStyle={{ gap: 20, paddingBottom: 4 }}
        keyboardShouldPersistTaps="handled"
      >
        <Identity />
        <StatusPicker />
        <CustomStatusField />
        <SheetRow
          icon={GearSix}
          label="Settings"
          onPress={() => {
            onClose();
            router.push("/settings");
          }}
        />
      </ScrollView>
    </Sheet>
  );
}
