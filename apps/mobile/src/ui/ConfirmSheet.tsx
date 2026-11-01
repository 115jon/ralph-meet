import { View } from "react-native";

import { Button } from "./Button";
import { Sheet } from "./Sheet";
import { Text } from "./Text";

export interface ConfirmRequest {
  /** Silkscreen kicker, e.g. the person's name. */
  readonly kicker: string;
  readonly title: string;
  readonly body: string;
  /** The confirm key's label, e.g. "Block". */
  readonly confirm: string;
  /** Irreversible: a danger fill. Otherwise the primary. */
  readonly danger?: boolean;
  readonly onConfirm: () => void;
}

/**
 * DESIGN's phone dialog: a bottom sheet with a kicker, a 22px title, the
 * body, and full-width 48px keys (Cancel, then the confirm).
 */
export function ConfirmSheet({
  request,
  onClose,
}: {
  request: ConfirmRequest | null;
  onClose: () => void;
}) {
  return (
    <Sheet
      visible={request !== null}
      onClose={onClose}
      label={request?.title ?? "Confirm"}
    >
      {request ? (
        <View style={{ paddingHorizontal: 16, gap: 8 }}>
          <Text variant="silk" tone="ink3" numberOfLines={1}>
            {request.kicker}
          </Text>
          <Text
            variant="display"
            accessibilityRole="header"
            style={{ fontSize: 22, lineHeight: 26, letterSpacing: -0.4 }}
          >
            {request.title}
          </Text>
          <Text variant="body" tone="ink2">
            {request.body}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <View style={{ flex: 1 }}>
              <Button variant="ghost" label="Cancel" onPress={onClose} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                variant={request.danger ? "danger" : "primary"}
                label={request.confirm}
                onPress={() => {
                  onClose();
                  request.onConfirm();
                }}
              />
            </View>
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}
