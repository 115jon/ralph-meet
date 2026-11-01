import type { LedState } from "@/ui";

/** Presence as the avatar LED: online talk, idle amber, dnd muted red. */
export function presenceLed(
  status: string | null | undefined,
): LedState | undefined {
  switch (status) {
    case "online":
      return "talk";
    case "idle":
      return "idle";
    case "dnd":
      return "danger";
    default:
      return undefined;
  }
}
