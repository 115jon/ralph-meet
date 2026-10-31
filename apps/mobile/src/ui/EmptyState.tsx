import { View } from "react-native";

import { Text } from "./Text";

interface EmptyStateProps {
  title: string;
  description: string;
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <View style={{ padding: 24, gap: 8 }}>
      <Text variant="title">{title}</Text>
      <Text variant="body" tone="ink2">
        {description}
      </Text>
    </View>
  );
}
