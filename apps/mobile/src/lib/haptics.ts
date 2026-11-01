import { hasNativeModule } from "./native";

// Subtle touch feedback, on acts the user commits to (a long-press menu, a
// reply swipe, a reaction, a send) and on the pager settling on a page; never
// on scroll. A dev client built before expo-haptics stays silent.

type HapticsModule = typeof import("expo-haptics");

const haptics: HapticsModule | null = hasNativeModule("ExpoHaptics")
  ? (require("expo-haptics") as HapticsModule)
  : null;

/** A light knock: a menu opening, a reply armed, a reaction, a send. */
export function tapHaptic(): void {
  haptics
    ?.impactAsync(haptics.ImpactFeedbackStyle.Light)
    .catch(() => undefined);
}

/** The faintest tick: the pager snapping to a page. */
export function selectionHaptic(): void {
  haptics?.selectionAsync().catch(() => undefined);
}
