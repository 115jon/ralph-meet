import type { GridItem } from "@/components/voice/types";
import type { SpatialPlacementMode, SpatialPosition } from "@/stores/useVoiceSettingsStore";

export interface SpatialParticipant {
  userId: string;
  name: string;
  avatar?: string | null;
  isSpeaking?: boolean;
  isSpatialEnabled?: boolean;
  isHighFidelity?: boolean;
}

export interface SharedSpatialAudioState {
  enabled: boolean;
  placementMode: SpatialPlacementMode;
  roomSize: number;
  distance: number;
  arcAngle: number;
  manualPositions: Record<string, SpatialPosition>;
  updatedBy?: string;
  updatedAt: number;
}

export interface SpatialAudioCapability {
  enabled: boolean;
  highFidelity: boolean;
}

export const DEFAULT_SHARED_SPATIAL_STATE: SharedSpatialAudioState = {
  enabled: false,
  placementMode: "arc",
  roomSize: 40,
  distance: 55,
  arcAngle: 120,
  manualPositions: {},
  updatedAt: 0,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function normalizeSpatialState(state?: Partial<SharedSpatialAudioState> | null): SharedSpatialAudioState {
  return {
    ...DEFAULT_SHARED_SPATIAL_STATE,
    ...state,
    roomSize: clamp(Math.round(state?.roomSize ?? DEFAULT_SHARED_SPATIAL_STATE.roomSize), 10, 100),
    distance: clamp(Math.round(state?.distance ?? DEFAULT_SHARED_SPATIAL_STATE.distance), 10, 95),
    arcAngle: clamp(Math.round(state?.arcAngle ?? DEFAULT_SHARED_SPATIAL_STATE.arcAngle), 30, 180),
    manualPositions: state?.manualPositions ?? {},
    updatedAt: state?.updatedAt ?? Date.now(),
  };
}

export function remoteSpatialParticipants(items: GridItem[]): SpatialParticipant[] {
  const seen = new Set<string>();
  return items
    .filter((item) => !item.isLocal && item.type !== "screen" && item.userId)
    .filter((item) => {
      if (seen.has(item.userId)) return false;
      seen.add(item.userId);
      return true;
    })
    .map((item) => ({
      userId: item.userId,
      name: item.name,
      avatar: item.avatar,
      isSpeaking: item.isSpeaking,
    }));
}

export function calculateSpatialPositions(
  participants: Array<{ userId: string }>,
  state: Pick<SharedSpatialAudioState, "placementMode" | "distance" | "arcAngle" | "manualPositions" | "roomSize">,
): Record<string, SpatialPosition> {
  const count = participants.length;
  if (count === 0) return {};

  if (state.placementMode === "manual") {
    return participants.reduce<Record<string, SpatialPosition>>((acc, participant, index) => {
      acc[participant.userId] = state.manualPositions[participant.userId] ?? autoPosition(index, count, "arc", state.distance, state.arcAngle);
      return acc;
    }, {});
  }

  return participants.reduce<Record<string, SpatialPosition>>((acc, participant, index) => {
    acc[participant.userId] = autoPosition(index, count, state.placementMode, state.distance, state.arcAngle);
    return acc;
  }, {});
}

function autoPosition(
  index: number,
  count: number,
  mode: SpatialPlacementMode,
  distance: number,
  arcAngle: number,
): SpatialPosition {
  if (mode === "line") {
    const span = Math.min(76, Math.max(24, distance * 1.25));
    const x = count === 1 ? 50 : 50 - span / 2 + (span * index) / (count - 1);
    return { x: clamp(x, 8, 92), y: clamp(48 - distance * 0.18, 14, 66) };
  }

  if (mode === "grid") {
    const cols = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / cols);
    const col = index % cols;
    const row = Math.floor(index / cols);
    const width = Math.min(78, Math.max(34, distance * 1.35));
    const height = Math.min(48, Math.max(24, distance * 0.8));
    const x = cols === 1 ? 50 : 50 - width / 2 + (width * col) / (cols - 1);
    const y = rows === 1 ? 44 : 30 + (height * row) / (rows - 1);
    return { x: clamp(x, 8, 92), y: clamp(y, 12, 70) };
  }

  const spread = count === 1 ? 0 : arcAngle;
  const start = -spread / 2;
  const angle = (start + (count === 1 ? 0 : (spread * index) / (count - 1))) * (Math.PI / 180);
  const radiusX = distance * 0.52;
  const radiusY = distance * 0.34;
  return {
    x: clamp(50 + Math.sin(angle) * radiusX, 8, 92),
    y: clamp(70 - Math.cos(angle) * radiusY, 12, 72),
  };
}

export function spatialPanFromPosition(position?: SpatialPosition): number {
  if (!position) return 0;
  return clamp((position.x - 50) / 50, -1, 1);
}

export function calculateSpatialAudioMix(
  selfPosition: SpatialPosition | undefined,
  peerPosition: SpatialPosition | undefined,
  roomSize: number,
): { pan: number; gain: number; distanceMeters: number } {
  if (!selfPosition || !peerPosition) {
    return { pan: 0, gain: 1, distanceMeters: 0 };
  }

  const normalizedRoomSize = clamp(roomSize, 10, 100);
  const roomSideMeters = Math.sqrt(normalizedRoomSize);
  const dxMeters = ((peerPosition.x - selfPosition.x) / 100) * roomSideMeters;
  const dyMeters = ((peerPosition.y - selfPosition.y) / 100) * roomSideMeters;
  const distanceMeters = Math.sqrt(dxMeters * dxMeters + dyMeters * dyMeters);
  const pan = clamp(dxMeters / Math.max(1.2, roomSideMeters * 0.38), -1, 1);
  const rolloffStartMeters = Math.max(0.75, roomSideMeters * 0.12);
  const rolloffRangeMeters = Math.max(1.5, roomSideMeters * 0.6);
  const rolloff = clamp((distanceMeters - rolloffStartMeters) / rolloffRangeMeters, 0, 1);
  const gain = clamp(1 - rolloff * 0.68, 0.32, 1);

  return { pan, gain, distanceMeters };
}
