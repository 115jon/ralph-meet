import { View } from "react-native";

import { Button, Sheet, Text } from "@/ui";

import type { JoinTarget } from "./actions";

interface VoiceSwitchSheetProps {
  /** The channel tapped while in another call; null hides the sheet. */
  target: JoinTarget | null;
  /** Where the call is now, e.g. "General in Ralph HQ". */
  currentPlace: string;
  /** Where the tapped channel is, said the same way. */
  targetPlace: string;
  onCancel: () => void;
  onSwitch: (target: JoinTarget) => void;
}

/**
 * Asked before a tap in the tree drops a call that may have run for hours,
 * as the web's VoiceSwitchModal does.
 */
export function VoiceSwitchSheet({
  target,
  currentPlace,
  targetPlace,
  onCancel,
  onSwitch,
}: VoiceSwitchSheetProps) {
  return (
    <Sheet
      visible={target !== null}
      onClose={onCancel}
      label="Switch voice channel"
    >
      {target ? (
        <View style={{ paddingHorizontal: 20, paddingTop: 4, gap: 8 }}>
          <Text variant="title" style={{ fontSize: 22, lineHeight: 26 }}>
            Switch voice channel?
          </Text>
          <Text variant="body" tone="ink2">
            {`You'll leave ${currentPlace} and join ${targetPlace}.`}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <View style={{ flex: 1 }}>
              <Button variant="ghost" label="Stay" onPress={onCancel} />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Switch" onPress={() => onSwitch(target)} />
            </View>
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}
