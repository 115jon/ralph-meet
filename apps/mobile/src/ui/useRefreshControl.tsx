import { useCallback, useState, type ReactElement } from "react";
import { RefreshControl } from "react-native";

import { useTheme } from "@/theme";

/**
 * Pull-to-refresh for a list: Android's spinner in ink on the float ply,
 * spinning until `load` settles. Pass the result as `refreshControl`.
 */
export function useRefreshControl(load: () => Promise<void>): ReactElement {
  const theme = useTheme();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load()
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  }, [load]);
  return (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      colors={[theme.ink1]}
      progressBackgroundColor={theme.ply3}
      tintColor={theme.ink1}
    />
  );
}
