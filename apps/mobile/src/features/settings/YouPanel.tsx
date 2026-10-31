import { useEffect, useState } from "react";
import { Pressable, TextInput, View } from "react-native";

import { useSession } from "@/features/auth/session";
import { unregisterPushToken } from "@/features/push/push";
import { FONT, RADIUS, useTheme } from "@/theme";
import { Button, Led, Skeleton, Text } from "@/ui";

import {
  type AccountSession,
  DISPLAY_NAME_MAX,
  fetchSessions,
  ProfileRejected,
  sessionDate,
  updateDisplayName,
} from "./api";
import { Row, Section } from "./rows";

const dateFormat = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function TextKey({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({
        height: 32,
        paddingHorizontal: 10,
        justifyContent: "center",
        borderRadius: RADIUS,
        backgroundColor: pressed ? theme.tint2 : "transparent",
      })}
    >
      <Text variant="control" tone={disabled ? "inkOff" : "accent"}>
        {label}
      </Text>
    </Pressable>
  );
}

function DisplayNameEditor({
  initial,
  onDone,
}: {
  initial: string;
  onDone: () => void;
}) {
  const theme = useTheme();
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unchanged = value.trim() === initial.trim();

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateDisplayName(value);
      onDone();
    } catch (cause) {
      setError(
        cause instanceof ProfileRejected
          ? cause.message
          : "Your name didn't save. Try again.",
      );
      setSaving(false);
    }
  };

  return (
    <View style={{ gap: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
      <TextInput
        value={value}
        onChangeText={setValue}
        autoFocus
        maxLength={DISPLAY_NAME_MAX}
        returnKeyType="done"
        onSubmitEditing={() => {
          if (!unchanged && !saving) void save();
        }}
        accessibilityLabel="Display name"
        placeholder="Display name"
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
      {error ? (
        <Text
          variant="row"
          accessibilityLiveRegion="polite"
          style={{ color: theme.dangerInk }}
        >
          {error}
        </Text>
      ) : null}
      <View
        style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8 }}
      >
        <TextKey label="Cancel" onPress={onDone} disabled={saving} />
        <TextKey
          label={saving ? "Saving" : "Save"}
          onPress={() => void save()}
          disabled={saving || unchanged}
        />
      </View>
    </View>
  );
}

function ProfileSection() {
  const user = useSession((s) => s.user);
  const [editing, setEditing] = useState(false);
  if (!user) {
    return (
      <Section title="Profile">
        <View style={{ paddingHorizontal: 12, gap: 8 }}>
          <Skeleton width="60%" height={16} />
          <Skeleton width="40%" height={16} />
        </View>
      </Section>
    );
  }
  return (
    <Section title="Profile">
      {editing ? (
        <DisplayNameEditor
          initial={user.display_name ?? ""}
          onDone={() => setEditing(false)}
        />
      ) : (
        <Row
          label="Display name"
          description={user.display_name ?? "Not set: your username shows"}
          trailing={<TextKey label="Edit" onPress={() => setEditing(true)} />}
        />
      )}
      <Row
        label="Username"
        description={`@${user.username}. Change it on the web app.`}
      />
    </Section>
  );
}

type SessionsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; sessions: readonly AccountSession[] };

function sessionLine(session: AccountSession): string {
  const active = sessionDate(session.lastActiveAt);
  const created = sessionDate(session.createdAt);
  if (active) return `Active ${dateFormat.format(active)}`;
  if (created) return `Signed in ${dateFormat.format(created)}`;
  return "The session you're using now";
}

function SessionsSection() {
  const [state, setState] = useState<SessionsState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    fetchSessions()
      .then((sessions) => {
        if (live) setState({ status: "ready", sessions });
      })
      .catch(() => {
        if (live) setState({ status: "error" });
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  const retry = () => {
    setState({ status: "loading" });
    setAttempt((count) => count + 1);
  };

  return (
    <Section title="Sessions">
      {state.status === "loading" ? (
        <View style={{ paddingHorizontal: 12 }}>
          <Skeleton width="70%" height={16} />
        </View>
      ) : null}
      {state.status === "error" ? (
        <Row
          label="Sessions didn't load"
          trailing={<TextKey label="Retry" onPress={retry} />}
        />
      ) : null}
      {state.status === "ready"
        ? state.sessions.map((session, index) => (
            <Row
              key={session.id ?? index}
              leading={<Led state={session.isCurrent ? "talk" : "off"} />}
              label={session.isCurrent ? "This device" : "Another device"}
              description={sessionLine(session)}
            />
          ))
        : null}
    </Section>
  );
}

function SignOutSection() {
  const signOut = useSession((s) => s.signOut);
  return (
    <Section title="Sign-in" note="Sign out of Ralph Meet on this device.">
      <View style={{ paddingHorizontal: 12, paddingTop: 4 }}>
        <Button
          variant="ghost"
          label="Sign out"
          // Unregister while the session can still authenticate the DELETE.
          onPress={() => void unregisterPushToken().finally(signOut)}
        />
      </View>
    </Section>
  );
}

/** 01 You: profile, where you're signed in, sign out. */
export function YouPanel() {
  return (
    <View style={{ gap: 24 }}>
      <ProfileSection />
      <SessionsSection />
      <SignOutSection />
    </View>
  );
}
