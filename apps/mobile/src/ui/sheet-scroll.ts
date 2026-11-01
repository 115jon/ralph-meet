import { createContext, use, useCallback } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import type { PanGesture } from "react-native-gesture-handler";
import type { SharedValue } from "react-native-reanimated";

export interface SheetScrollValue {
  gesture: PanGesture;
  scrollEnabled: boolean;
  scrollY: SharedValue<number>;
}

export const SheetScrollContext = createContext<SheetScrollValue | null>(null);

/** Props that hand a gesture-handler ScrollView or FlatList over to its sheet. */
export interface SheetScrollProps {
  simultaneousWith?: PanGesture;
  scrollEnabled?: boolean;
  onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  scrollEventThrottle?: number;
  overScrollMode?: "never";
}

/**
 * For a list inside a sheet (a gesture-handler ScrollView or FlatList): it
 * scrolls once the sheet is at its full stop, and pulling down from its top
 * drags the sheet. Outside a sheet it gives nothing.
 */
export function useSheetScroll(): SheetScrollProps {
  const context = use(SheetScrollContext);
  const scrollY = context?.scrollY;
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) =>
      scrollY?.set(event.nativeEvent.contentOffset.y),
    [scrollY],
  );
  if (!context) return {};
  return {
    simultaneousWith: context.gesture,
    scrollEnabled: context.scrollEnabled,
    onScroll,
    scrollEventThrottle: 16,
    overScrollMode: "never",
  };
}
