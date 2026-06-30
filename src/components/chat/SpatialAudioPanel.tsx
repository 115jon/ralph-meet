import { Button } from "@/components/ui/button";
import type { GridItem } from "@/components/voice/types";
import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import {
  calculateSpatialPositions,
  normalizeSpatialState,
  remoteSpatialParticipants,
  type SpatialParticipant,
  type SharedSpatialAudioState,
} from "@/lib/voice/spatial-audio";
import type { SpatialPlacementMode } from "@/stores/useVoiceSettingsStore";
import { DndContext, type DragEndEvent, useDraggable } from "@dnd-kit/core";
import { AlertTriangle, Minus, Move, Plus, RotateCcw } from "lucide-react";
import { useMemo, useRef, useState } from "react";

interface SpatialAudioPanelProps {
  isClosing?: boolean;
  isOpen: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  gridItems: GridItem[];
  spatialAudioState: SharedSpatialAudioState;
  onUpdateSpatialAudioState: (state: SharedSpatialAudioState) => void;
  localSpatialEnabled: boolean;
  localHighFidelity: boolean;
  localUserId?: string | null;
  participantCapabilities?: Record<string, { enabled?: boolean; highFidelity?: boolean }>;
  onLocalSpatialEnabledChange: (enabled: boolean) => void;
  onOpenVoiceSettings: () => void;
  onClose: () => void;
}

const MODES: Array<{ value: SpatialPlacementMode; label: string }> = [
  { value: "line", label: "Line" },
  { value: "arc", label: "Arc" },
  { value: "grid", label: "Grid" },
  { value: "manual", label: "Manual" },
];
const EMPTY_PARTICIPANT_CAPABILITIES: Record<string, { enabled?: boolean; highFidelity?: boolean }> = {};

function DraggableAvatar({
  participant,
  position,
  disabled,
  inactive,
}: {
  participant: SpatialParticipant;
  position: { x: number; y: number };
  disabled: boolean;
  inactive: boolean;
}) {
  const isSelf = participant.name === "You";
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: participant.userId,
    disabled,
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      title={inactive ? `${participant.name} is not hearing spatial audio` : participant.name}
      className={cn(
        "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-lg transition-shadow outline-none",
        isSelf ? "h-9 w-9 border-primary bg-primary shadow-primary/30" : "h-9 w-9 bg-rm-bg-elevated",
        participant.isSpeaking && !isSelf ? "border-primary shadow-primary/30" : "border-rm-border",
        inactive && "grayscale opacity-55 border-amber-400/70",
        isDragging && "z-20 shadow-2xl",
        disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing",
      )}
      style={{
        left: `${position.x}%`,
        top: `${position.y}%`,
        transform: `translate(-50%, -50%) translate(${transform?.x ?? 0}px, ${transform?.y ?? 0}px)`,
      }}
      {...listeners}
      {...attributes}
    >
      {isSelf && (
        <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 text-[11px] font-black text-rm-text">
          You
        </span>
      )}
      {!isSelf && (
        <span className="absolute inset-0 overflow-hidden rounded-full">
          {participant.avatar ? (
            <img src={getAuthAssetUrl(participant.avatar)} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-xs font-black text-rm-text">
              {participant.name[0]?.toUpperCase()}
            </span>
          )}
        </span>
      )}
      {inactive && (
        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-black text-black">
          !
        </span>
      )}
    </button>
  );
}

export function SpatialAudioPanel({
  isOpen,
  isClosing,
  gridItems,
  spatialAudioState,
  onUpdateSpatialAudioState,
  localSpatialEnabled,
  localHighFidelity,
  localUserId,
  participantCapabilities = EMPTY_PARTICIPANT_CAPABILITIES,
  onLocalSpatialEnabledChange,
  onOpenVoiceSettings,
  onClose,
}: SpatialAudioPanelProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const state = normalizeSpatialState(spatialAudioState);
  const participants = useMemo<SpatialParticipant[]>(() => [
    { userId: localUserId || "self", name: "You", isSpatialEnabled: localSpatialEnabled, isHighFidelity: localHighFidelity },
    ...remoteSpatialParticipants(gridItems),
  ], [gridItems, localSpatialEnabled, localHighFidelity, localUserId]);
  const positions = useMemo(() => calculateSpatialPositions(participants, state), [participants, state]);
  const blocked = !localHighFidelity;
  const roomVisualScale = 1.16 - ((state.roomSize - 10) / 90) * 0.34;
  const totalZoom = view.zoom * roomVisualScale;

  if (!isOpen) return null;

  const commit = (patch: Partial<SharedSpatialAudioState>) => {
    const next = normalizeSpatialState({ ...state, ...patch, updatedAt: Date.now() });
    onUpdateSpatialAudioState(next);
  };

  const onDragEnd = (event: DragEndEvent) => {
    if (state.placementMode !== "manual" || !worldRef.current || !event.active?.id) return;
    const participantId = String(event.active.id);
    const current = positions[participantId];
    if (!current) return;
    const rect = worldRef.current.getBoundingClientRect();
    const next = {
      x: Math.min(95, Math.max(5, current.x + (event.delta.x / rect.width) * 100)),
      y: Math.min(82, Math.max(8, current.y + (event.delta.y / rect.height) * 100)),
    };
    commit({
      placementMode: "manual",
      manualPositions: {
        ...state.manualPositions,
        [participantId]: next,
      },
    });
  };

  const onWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    setView((current) => ({
      ...current,
      zoom: Math.min(1.8, Math.max(0.65, current.zoom + direction * 0.08)),
    }));
  };

  const onMapPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button,input")) return;
    panStartRef.current = { x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onMapPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = panStartRef.current;
    if (!start) return;
    setView((current) => ({
      ...current,
      panX: Math.min(160, Math.max(-160, start.panX + event.clientX - start.x)),
      panY: Math.min(120, Math.max(-120, start.panY + event.clientY - start.y)),
    }));
  };

  const stopMapPan = (event: React.PointerEvent<HTMLDivElement>) => {
    panStartRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <>
      {!isClosing && (
        <button
          type="button"
          className="fixed inset-0 z-[80]"
          aria-label="Close spatial audio panel"
          onClick={onClose}
        />
      )}
      <div className={cn("absolute bottom-full left-0 z-[90] mb-3 w-[min(620px,calc(100vw-24px))] rounded-xl border border-rm-border bg-rm-bg-primary p-4 shadow-2xl origin-bottom-left", isClosing ? "animate-out fade-out zoom-out-95 duration-200" : "animate-in fade-in zoom-in-95 duration-200")}>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-black text-rm-text">Spatial Audio</h3>
            <p className="mt-1 text-xs text-rm-text-muted">Shared room placement for everyone in this voice session.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-xs font-bold text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text">
            Close
          </button>
        </div>

        {blocked && (
          <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-amber-400/30 bg-amber-500/10 p-3">
            <div className="flex items-center gap-2 text-xs text-amber-200">
              <AlertTriangle size={16} />
              High Fidelity Audio is required to hear spatial audio.
            </div>
            <Button size="sm" onClick={onOpenVoiceSettings}>Open Voice Settings</Button>
          </div>
        )}

        <div className="mb-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              const nextEnabled = !state.enabled;
              onLocalSpatialEnabledChange(nextEnabled);
              commit({ enabled: nextEnabled });
            }}
            className={cn(
              "rounded-lg px-3 py-2 text-xs font-black transition-colors",
              state.enabled && localSpatialEnabled && localHighFidelity
                ? "bg-primary text-primary-foreground"
                : "bg-rm-bg-elevated text-rm-text-muted hover:text-rm-text",
            )}
          >
            {state.enabled ? "Spatial Enabled" : "Spatial Disabled"}
          </button>
          <button
            type="button"
            onClick={() => commit({ ...normalizeSpatialState(null), updatedAt: Date.now() })}
            className="flex items-center gap-2 rounded-lg bg-rm-bg-elevated px-3 py-2 text-xs font-bold text-rm-text-muted hover:text-rm-text"
          >
            <RotateCcw size={14} /> Reset
          </button>
        </div>

        <div className="mb-4 grid grid-cols-4 gap-2">
          {MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              onClick={() => commit({ placementMode: mode.value })}
              className={cn(
                "rounded-md px-3 py-2 text-xs font-bold transition-colors",
                state.placementMode === mode.value ? "bg-primary text-primary-foreground" : "bg-rm-bg-elevated text-rm-text-muted hover:text-rm-text",
              )}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <div className="mb-4 grid gap-4 md:grid-cols-3">
          {[
            ["Room Size", "roomSize", 10, 100],
            ["Distance", "distance", 10, 95],
            ["Arc Angle", "arcAngle", 30, 180],
          ].map(([label, key, min, max]) => (
            <label key={key} className="space-y-2 text-xs font-bold text-rm-text-muted">
              <span className="flex justify-between"><span>{label}</span><span>{(state as any)[key]}</span></span>
              <input
                type="range"
                min={min as number}
                max={max as number}
                value={(state as any)[key]}
                onChange={(event) => commit({ [key]: Number(event.target.value) } as Partial<SharedSpatialAudioState>)}
                className="w-full accent-primary"
              />
            </label>
          ))}
        </div>

        <DndContext onDragEnd={onDragEnd}>
          <div
            ref={mapRef}
            className="relative h-[360px] touch-none overflow-hidden rounded-lg border border-rm-border bg-rm-bg-surface"
            onWheel={onWheel}
            onPointerDown={onMapPointerDown}
            onPointerMove={onMapPointerMove}
            onPointerUp={stopMapPan}
            onPointerCancel={stopMapPan}
          >
            <div
              ref={worldRef}
              className="absolute inset-0 cursor-grab bg-[linear-gradient(rgba(0,0,0,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.08)_1px,transparent_1px)] dark:bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] active:cursor-grabbing"
              style={{
                backgroundSize: `${Math.max(38, 78 / totalZoom)}px ${Math.max(38, 78 / totalZoom)}px`,
                transform: `translate(${view.panX}px, ${view.panY}px) scale(${totalZoom})`,
                transformOrigin: "50% 58%",
              }}
            >
              <div className="absolute left-4 top-4 rounded-md border border-rm-border bg-rm-bg-hover/80 backdrop-blur-sm px-2 py-1 text-[11px] font-bold text-rm-text-muted">
                {state.roomSize} m² room
              </div>
              {participants.map((participant) => {
                const caps = participant.userId === (localUserId || "self")
                  ? { enabled: localSpatialEnabled, highFidelity: localHighFidelity }
                  : participantCapabilities[participant.userId];
                const inactive = !caps?.enabled || !caps?.highFidelity;
                return (
                  <DraggableAvatar
                    key={participant.userId}
                    participant={participant}
                    position={positions[participant.userId] ?? { x: 50, y: 50 }}
                    disabled={state.placementMode !== "manual"}
                    inactive={inactive}
                  />
                );
              })}
            </div>
            <div className="absolute right-3 top-3 flex overflow-hidden rounded-md border border-rm-border bg-rm-bg-hover/80 backdrop-blur-sm">
              <button
                type="button"
                title="Zoom out"
                onClick={() => setView((current) => ({ ...current, zoom: Math.max(0.65, current.zoom - 0.12) }))}
                className="flex h-8 w-8 items-center justify-center text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
              >
                <Minus size={14} />
              </button>
              <button
                type="button"
                title="Reset view"
                onClick={() => setView({ zoom: 1, panX: 0, panY: 0 })}
                className="border-x border-rm-border px-2 text-[11px] font-black text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
              >
                {Math.round(totalZoom * 100)}%
              </button>
              <button
                type="button"
                title="Zoom in"
                onClick={() => setView((current) => ({ ...current, zoom: Math.min(1.8, current.zoom + 0.12) }))}
                className="flex h-8 w-8 items-center justify-center text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
              >
                <Plus size={14} />
              </button>
            </div>
            {state.placementMode === "manual" && (
              <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-md bg-rm-bg-hover/80 backdrop-blur-sm px-2 py-1 text-[11px] font-bold text-rm-text-muted">
                <Move size={13} /> Drag members to reposition everyone
              </div>
            )}
          </div>
        </DndContext>
      </div>
    </>
  );
}
