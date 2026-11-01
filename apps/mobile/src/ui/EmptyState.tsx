import { View } from "react-native";

import { Button } from "./Button";
import { Text } from "./Text";

interface EmptyStateProps {
  title: string;
  description: string;
  /** At most one action. */
  action?: { label: string; onPress: () => void };
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <View style={{ padding: 24, gap: 8 }}>
      <Text variant="title">{title}</Text>
      <Text variant="body" tone="ink2" style={{ maxWidth: 320 }}>
        {description}
      </Text>
      {action ? (
        <View style={{ marginTop: 8, alignSelf: "flex-start" }}>
          <Button
            variant="ghost"
            label={action.label}
            onPress={action.onPress}
          />
        </View>
      ) : null}
    </View>
  );
}
