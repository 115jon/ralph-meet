import type { IconState } from "@/components/ui/icon";

/**
 * The voice dock recipe (design-system 12.13), shared by every voice control:
 * the stage dock (VoiceControls), the DM call dock, the sidebar voice strip
 * (VoiceDashboard) and the user panel's mic/deafen buttons.
 *
 *   rest   neutral tint, Bold glyph            mic on, camera off
 *   open   stronger neutral tint, Fill glyph   a picker or tray this opens
 *   muted  danger tint, the "off" Fill glyph   mic muted, deafened
 *   live   accent tint, Fill glyph             camera on, sharing
 *
 * Nothing here is a solid fill: Leave (`variant="danger"` Button / the
 * `DOCK_LEAVE` class) is the one solid in a dock, and Stop Watching / Leave
 * Activity use `DOCK_DESTRUCTIVE`, the red tint.
 */
export type DockState = "rest" | "open" | "muted" | "live";

const STATE_CLASSES: Record<DockState, string> = {
  rest: "bg-rm-tint-1 text-rm-text",
  open: "bg-rm-tint-3 text-rm-text",
  muted: "bg-rm-danger-tint text-rm-danger-ink",
  live: "bg-rm-accent-tint text-rm-accent-ink [--hover-o:0.12]",
};

/**
 * `quiet` drops the resting tint for dense rows (the user panel), where a
 * row of tinted squares would read as a toolbar of pressed buttons. Muted
 * and live keep their tint so the state never relies on the glyph alone.
 */
const QUIET_REST = "bg-transparent text-rm-text-secondary";

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

/** The one solid fill in a dock: leave the call. */
export const DOCK_LEAVE = "bg-rm-danger text-rm-on-danger [--hover-o:0.12]";

/** Stop Watching / Leave Activity: red tint, not solid (13.2 destructive). */
export const DOCK_DESTRUCTIVE = "bg-rm-danger-tint text-rm-danger-ink";

/**
 * Accept a call (DM lobby, incoming call modal): the conventional green, on
 * the theme's success token so both surfaces share one colour.
 */
export const CALL_ACCEPT = "bg-rm-success text-rm-on-success [--hover-o:0.12]";
