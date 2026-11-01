import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";

/** Floating panel geometry (dp). */
export const PLATE_INSET_X = 12;
/** Gap between the plate and the bottom safe-area inset. */
export const PLATE_BOTTOM_GAP = 22;
/** Air between the last row of a list and the plate's top edge. */
const PLATE_AIR = 12;
/** The "you" row alone, until the plate first measures itself. */
const ME_ROW_ESTIMATE = 64;

const usePlateStore = create<{ height: number }>()(() => ({
  height: ME_ROW_ESTIMATE,
}));

/** Called from the plate's onLayout; the plate grows with a call row. */
export function setPlateHeight(height: number): void {
  if (usePlateStore.getState().height !== height) {
    usePlateStore.setState({ height });
  }
}

/** Bottom padding that keeps a list's last row clear of the plate. */
export function usePlateClearance(): number {
  const insets = useSafeAreaInsets();
  const height = usePlateStore((s) => s.height);
  return insets.bottom + PLATE_BOTTOM_GAP + height + PLATE_AIR;
}
