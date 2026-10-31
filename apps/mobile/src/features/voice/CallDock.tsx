import {
  Headphones,
  Microphone,
  MicrophoneSlash,
  PhoneX,
  SpeakerSlash,
  type Icon as PhosphorIcon,
} from "phosphor-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AudioRouteSheet } from "@/features/call-service/AudioRouteSheet";
import {
  routeIcon,
  routeLabel,
  useActiveRoute,
} from "@/features/call-service/routes";
import { askBluetoothPermission } from "@/features/call-service/service";
import { RADIUS, useTheme } from "@/theme";
import { Icon } from "@/ui";

import { leaveCall, toggleDeafen, toggleMute } from "./actions";

interface DockKeyProps {
  icon: PhosphorIcon;
  label: string;
  /** On: muted or deafened, shown in danger. */
  on?: boolean;
  danger?: boolean;
  onPress: () => void;
}

function DockKey({
  icon,
  label,
  on = false,
  danger = false,
  onPress,
}: DockKeyProps) {
  const theme = useTheme();
  const background = danger
    ? theme.dangerFill
    : on
      ? theme.dangerTint
      : theme.tint1;
  const color = danger ? theme.onDanger : on ? theme.dangerInk : theme.ink1;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={danger ? undefined : { selected: on }}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: danger ? 1.25 : 1,
        height: 56,
        borderRadius: RADIUS,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: background,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Icon icon={icon} active={on || danger} size={24} color={color} />
    </Pressable>
  );
}

interface CallDockProps {
  muted: boolean;
  deafened: boolean;
  bottomInset: number;
}

/**
 * Floating ply-3 plate under a 2px ink rule: Mute, Deafen, the audio route
 * (when the phone reports routes), Leave.
 */
export function CallDock({ muted, deafened, bottomInset }: CallDockProps) {
  const theme = useTheme();
  const route = useActiveRoute();
  const [routesOpen, setRoutesOpen] = useState(false);
  const openRoutes = () => {
    setRoutesOpen(true);
    void askBluetoothPermission();
  };
  return (
    <View
      style={{
        marginHorizontal: 12,
        marginBottom: bottomInset + 22,
        padding: 10,
        flexDirection: "row",
        gap: 8,
        borderRadius: RADIUS,
        backgroundColor: theme.ply3,
        borderWidth: 1,
        borderColor: theme.lineStrong,
        borderTopWidth: 2,
        borderTopColor: theme.ink1,
        shadowColor: theme.shadow,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 1,
        shadowRadius: 12,
        elevation: 12,
      }}
    >
      <DockKey
        icon={muted ? MicrophoneSlash : Microphone}
        label={muted ? "Unmute" : "Mute"}
        on={muted}
        onPress={toggleMute}
      />
      <DockKey
        icon={deafened ? SpeakerSlash : Headphones}
        label={deafened ? "Undeafen" : "Deafen"}
        on={deafened}
        onPress={toggleDeafen}
      />
      {route ? (
        <DockKey
          icon={routeIcon(route.type)}
          label={`Audio output: ${routeLabel(route)}`}
          onPress={openRoutes}
        />
      ) : null}
      <DockKey
        icon={PhoneX}
        label="Leave the call"
        danger
        onPress={leaveCall}
      />
      <AudioRouteSheet
        visible={routesOpen}
        onClose={() => setRoutesOpen(false)}
      />
    </View>
  );
}
