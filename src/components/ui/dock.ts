import type { IconState } from "@/components/ui/icon";

/**
 * The call-control recipe (talk-tree-spec §3, §7), shared by every voice
 * control: the stage bar (VoiceControls), the DM call bar, the call strip
 * (VoiceDashboard) and the account row's mic/deafen buttons.
 *
 *   rest   neutral tint, Bold glyph                  mic on, camera off
 *   open   stronger neutral tint, Fill glyph         a picker or tray this opens
 *   muted  muted-state tint + ink, "off" Fill glyph  mic muted, deafened
 *   live   live (azure) tint + ink, Fill glyph       camera on, sharing
 *
 * Muted and live never share a hue in any theme (tokens contract). Nothing
 * here is a solid fill: Leave (`DOCK_LEAVE`) is the one solid danger fill in
 * any call surface, and it always means "leave the call". Stop watching and
 * leaving an activity are neutral `rest` buttons, not red.
 */
export type DockState = "rest" | "open" | "muted" | "live";

const STATE_CLASSES: Record<DockState, string> = {
  rest: "bg-tint-1 text-ink-1",
  open: "bg-tint-3 text-ink-1",
  muted: "bg-muted-state-tint text-muted-state",
  live: "bg-live-tint text-live-ink [--hover-o:0.12]",
};

/**
 * `quiet` drops the resting tint for dense rows (the user panel), where a
 * row of tinted squares would read as a toolbar of pressed buttons. Muted
 * and live keep their tint so the state never relies on the glyph alone.
 */
const QUIET_REST = "bg-transparent text-ink-2";

export function dockState(
  state: DockState,
  options: { quiet?: boolean } = {},
): string {
  if (state === "rest" && options.quiet) return QUIET_REST;
  return STATE_CLASSES[state];
}

/** Glyph weight per state: muted draws the off partner, open/live fill. */
export function dockIconState(state: DockState): IconState {
  if (state === "muted") return "off";
  if (state === "rest") return "idle";
  return "active";
}

/** The one solid fill in a call surface: leave (or decline) the call. */
export const DOCK_LEAVE = "bg-danger-fill text-on-danger [--hover-o:0.12]";

/**
 * Destructive rows that aren't leaving (13.2): red tint, never solid. Not
 * used in the call bars any more; kept for menus.
 */
export const DOCK_DESTRUCTIVE = "bg-danger-tint text-danger-ink";

/**
 * Accept a call (DM lobby, incoming call modal): the talk LED green, with
 * its contrast-checked ink.
 */
export const CALL_ACCEPT = "bg-talk text-on-talk [--hover-o:0.12]";
