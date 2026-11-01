import { useEffect } from "react";
import { create } from "zustand";

import * as RalphCall from "../../../modules/ralph-call/src";

// Picture-in-picture for the call screen (ralph-call CallPip). The screen
// arms it while a camera or a share is on screen; leaving the app then
// shrinks the call into Android's PiP window with Mute and Leave, and the
// screen draws its compact layout while `active`.

interface PipState {
  readonly active: boolean;
}

export const usePipStore = create<PipState>()(() => ({
  active: RalphCall.isInPip(),
}));

RalphCall.onPipModeChanged((active) => usePipStore.setState({ active }));

export function usePipActive(): boolean {
  return usePipStore((s) => s.active);
}

/** Read synchronously: Android is already in PiP when the app pauses for it. */
export function inPip(): boolean {
  return RalphCall.isInPip();
}

export interface PipTarget {
  /** The video's shape: 16:9 for a share, the camera's own otherwise. */
  readonly aspectWidth: number;
  readonly aspectHeight: number;
  readonly muted: boolean;
}

/**
 * Arms PiP with `target` while it is set (and the caller is mounted);
 * null, or unmounting, disarms it.
 */
export function useArmPip(target: PipTarget | null): void {
  const width = target?.aspectWidth ?? 0;
  const height = target?.aspectHeight ?? 0;
  const muted = target?.muted ?? false;
  const armed = target !== null;
  useEffect(() => {
    if (!armed) return;
    RalphCall.setPip({ aspectWidth: width, aspectHeight: height, muted }).catch(
      (error: unknown) => console.warn("[Call] Could not arm PiP", error),
    );
    return () => {
      RalphCall.setPip(null).catch(() => undefined);
    };
  }, [armed, width, height, muted]);
}

/** Leaves the PiP window (the call ended, or no video is left to show). */
export function closePip(): void {
  RalphCall.closePip().catch(() => undefined);
}

/** The call screen may rotate while mounted; portrait comes back after. */
export function useRotationUnlocked(unlocked: boolean): void {
  useEffect(() => {
    if (!unlocked) return;
    RalphCall.setRotationUnlocked(true).catch(() => undefined);
    return () => {
      RalphCall.setRotationUnlocked(false).catch(() => undefined);
    };
  }, [unlocked]);
}
