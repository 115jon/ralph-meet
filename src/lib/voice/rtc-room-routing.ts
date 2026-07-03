export type RtcRoomAuthorityMode = "split" | "canary" | "rtc-room";
export type RtcSocketRole = "control" | "media";

export function normalizeRtcRoomAuthorityMode(value: string | null | undefined): RtcRoomAuthorityMode {
  if (value === "rtc-room" || value === "canary") return value;
  return "split";
}

export function parseRtcRoomCanaryRooms(value: string | null | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

export function usesRtcRoomAuthority(
  modeValue: string | null | undefined,
  roomSlug?: string | null,
  canaryRoomsValue?: string | null | undefined,
): boolean {
  const mode = normalizeRtcRoomAuthorityMode(modeValue);
  if (mode === "rtc-room") return true;
  if (mode !== "canary") return false;
  if (!roomSlug) return false;
  return parseRtcRoomCanaryRooms(canaryRoomsValue).has(roomSlug);
}
