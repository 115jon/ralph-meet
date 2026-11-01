import { useCallback, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import Animated, { Easing, LinearTransition } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ProfileSheet } from "@/features/presence/ProfileSheet";
import { RADIUS, useTheme } from "@/theme";

import { CallRow } from "./CallRow";
import { useCallRow } from "./call-row";
import { MeRow } from "./MeRow";
import { PLATE_BOTTOM_GAP, PLATE_INSET_X, setPlateHeight } from "./metrics";

// One height change per call start or end, on the compositor-friendly
// layout transition; Reanimated skips it when the system reduces motion.
const GROW = LinearTransition.duration(200).easing(Easing.out(Easing.cubic));

/**
 * Your panel: one floating ply-3 plate under a 2px ink rule, like Discord's
 * user panel. It always holds you; rows stack above you as features need
 * them (the call row today). Its measured height pads the lists under it.
 */
export function YourPanel() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const call = useCallRow();
  const [profileOpen, setProfileOpen] = useState(false);
  const openProfile = useCallback(() => setProfileOpen(true), []);
  const closeProfile = useCallback(() => setProfileOpen(false), []);
  const onLayout = useCallback(
    (event: LayoutChangeEvent) =>
      setPlateHeight(Math.ceil(event.nativeEvent.layout.height)),
    [],
  );

  return (
    <>
      <Animated.View
        layout={GROW}
        onLayout={onLayout}
        style={{
          position: "absolute",
          left: PLATE_INSET_X,
          right: PLATE_INSET_X,
          bottom: insets.bottom + PLATE_BOTTOM_GAP,
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
        {call ? <CallRow call={call} /> : null}
        <MeRow onOpenProfile={openProfile} />
      </Animated.View>
      <ProfileSheet visible={profileOpen} onClose={closeProfile} />
    </>
  );
}
