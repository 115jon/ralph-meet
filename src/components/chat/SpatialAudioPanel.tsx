import { Button } from "@/components/ui/button";
import { useIsSpeaking } from "@/hooks/useIsSpeaking";
import { AvatarImage } from "@/components/chat/AvatarImage";
import { avatarShape } from "@/components/ui/avatar-shape";
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
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { HIT, PRESS } from "@/components/ui/interaction";
import { Num } from "@/components/ui/num";
import { ResponsivePopover } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useId, useMemo, useRef, useState } from "react";

interface SpatialAudioPanelProps {
  isOpen: boolean;
  /** The toggle that opens the panel; the popover anchors to it. */
  anchorRef: React.RefObject<HTMLElement | null>;
  gridItems: GridItem[];
  spatialAudioState: SharedSpatialAudioState;
  onUpdateSpatialAudioState: (state: SharedSpatialAudioState) => void;
  localSpatialEnabled: boolean;
  localHighFidelity: boolean;
  localUserId?: string | null;
  participantCapabilities?: Record<
    string,
    { enabled?: boolean; highFidelity?: boolean }
  >;
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
const SLIDERS = [
  { label: "Room size", key: "roomSize", min: 10, max: 100 },
  { label: "Distance", key: "distance", min: 10, max: 95 },
  { label: "Arc angle", key: "arcAngle", min: 30, max: 180 },
] as const;
const EMPTY_PARTICIPANT_CAPABILITIES: Record<
  string,
  { enabled?: boolean; highFidelity?: boolean }
> = {};

function SpatialSlider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label
      // Dragging must not swipe the phone drawer.
      data-base-ui-swipe-ignore=""
      className="flex flex-col gap-2 text-ui-sm font-medium text-ink-2"
    >
      <span className="flex items-center justify-between">
        <span>{label}</span>
        <Num className="text-ink-1">{value}</Num>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-primary-fill"
      />
    </label>
  );
}

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
  const isSpeaking = useIsSpeaking(participant.userId);
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: participant.userId,
      disabled,
    });

  return (
    <button
      ref={setNodeRef}
      type="button"
      data-speaking={isSpeaking ? "" : undefined}
      title={
        inactive
          ? `${participant.name} is not hearing spatial audio`
          : participant.name
      }
      className={cn(
        "absolute size-9 -translate-x-1/2 -translate-y-1/2 border-2 outline-none",
        // No clip: HIT's pseudo-element extends the target outward.
        avatarShape(
          !isSelf && participant.avatar && participant.avatarDisplay,
          { clip: false },
        ),
        HIT,
        isSelf ? "bg-primary-fill" : "bg-ply-3",
        isSpeaking ? "border-talk" : "border-line-strong",
        inactive && "border-warning-ink opacity-55 grayscale",
        isDragging && "z-20 shadow-float",
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
        <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 text-ui-2xs font-semibold text-ink-1">
          You
        </span>
      )}
      {!isSelf && (
        <span className="absolute inset-0 overflow-visible rounded-[inherit]">
          {participant.avatar ? (
            <AvatarImage
              src={getAuthAssetUrl(participant.avatar)}
              alt=""
              display={participant.avatarDisplay ?? null}
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-ui-xs font-semibold text-ink-1">
              {participant.name[0]?.toUpperCase()}
            </span>
          )}
        </span>
      )}
      {inactive && (
        <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full border border-warning-ink bg-ply-3 text-warning-ink">
          <Icon name="warning" size="xs" />
        </span>
      )}
    </button>
  );
}

export function SpatialAudioPanel({
  isOpen,
  anchorRef,
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
  const enabledId = useId();
  const mapRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const panStartRef = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const state = normalizeSpatialState(spatialAudioState);
  const participants = useMemo<SpatialParticipant[]>(
    () => [
      {
        userId: localUserId || "self",
        name: "You",
        isSpatialEnabled: localSpatialEnabled,
        isHighFidelity: localHighFidelity,
      },
      ...remoteSpatialParticipants(gridItems),
    ],
    [gridItems, localSpatialEnabled, localHighFidelity, localUserId],
  );
  const positions = useMemo(
    () => calculateSpatialPositions(participants, state),
    [participants, state],
  );
  const blocked = !localHighFidelity;
  const roomVisualScale = 1.16 - ((state.roomSize - 10) / 90) * 0.34;
  const totalZoom = view.zoom * roomVisualScale;

  const commit = (patch: Partial<SharedSpatialAudioState>) => {
    const next = normalizeSpatialState({
      ...state,
      ...patch,
      updatedAt: Date.now(),
    });
    onUpdateSpatialAudioState(next);
  };

  const onDragEnd = (event: DragEndEvent) => {
    if (
      state.placementMode !== "manual" ||
      !worldRef.current ||
      !event.active?.id
    )
      return;
    const participantId = String(event.active.id);
    const current = positions[participantId];
    if (!current) return;
    const rect = worldRef.current.getBoundingClientRect();
    const next = {
      x: Math.min(
        95,
        Math.max(5, current.x + (event.delta.x / rect.width) * 100),
      ),
      y: Math.min(
        82,
        Math.max(8, current.y + (event.delta.y / rect.height) * 100),
      ),
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
    panStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      panX: view.panX,
      panY: view.panY,
    };
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

  // Popover anchored to the toggle on desktop, bottom drawer on phones
  // (design-system 13.1). The primitive owns placement, Escape, the back
  // button, outside presses and focus return.
  return (
    <ResponsivePopover
      open={isOpen}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      title="Spatial audio"
      variant="rich"
      anchor={anchorRef}
      side="top"
      // Wider than a rich popover: the placement map needs the room.
      className="w-[min(620px,var(--available-width))] max-w-none p-4"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-ui-md font-semibold text-ink-1">Spatial audio</h3>
          <p className="mt-1 text-ui-sm text-ink-2">
            Shared room placement for everyone in this voice session.
          </p>
        </div>
        <IconButton
          icon="close"
          size={28}
          variant="muted"
          aria-label="Close spatial audio"
          onClick={onClose}
        />
      </div>

      {blocked && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-md bg-warning-tint px-3 py-2">
          <div className="flex items-center gap-2 text-ui-sm text-warning-ink">
            <Icon name="warning" size="sm" className="shrink-0" />
            Turn on high-fidelity audio to hear spatial audio.
          </div>
          <Button size="sm" variant="secondary" onClick={onOpenVoiceSettings}>
            Open voice settings
          </Button>
        </div>
      )}

      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Switch
            id={enabledId}
            aria-label="Spatial audio"
            checked={state.enabled}
            onCheckedChange={(nextEnabled) => {
              onLocalSpatialEnabledChange(nextEnabled);
              commit({ enabled: nextEnabled });
            }}
          />
          <label
            htmlFor={enabledId}
            className="text-ui-sm font-medium text-ink-1 select-none"
          >
            {state.enabled ? "On" : "Off"}
          </label>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() =>
            commit({ ...normalizeSpatialState(null), updatedAt: Date.now() })
          }
        >
          <Icon name="reset" size="sm" /> Reset
        </Button>
      </div>

      <div
        role="group"
        aria-label="Placement"
        className="mb-4 grid grid-cols-4 gap-0.5 rounded-md bg-tint-1 p-0.5"
      >
        {MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            onClick={() => commit({ placementMode: mode.value })}
            aria-pressed={state.placementMode === mode.value}
            className={cn(
              "relative h-7 rounded-sm px-3 text-ui-sm font-medium outline-none transition-colors duration-(--dur-1) ease-out",
              HIT,
              state.placementMode === mode.value
                ? "bg-accent-tint font-semibold text-accent-ink"
                : "text-ink-2 pointer-fine:hover:text-ink-1",
            )}
          >
            {mode.label}
          </button>
        ))}
      </div>

      <div className="mb-4 grid gap-4 md:grid-cols-3">
        {SLIDERS.map(({ label, key, min, max }) => (
          <SpatialSlider
            key={key}
            label={label}
            value={state[key]}
            min={min}
            max={max}
            onChange={(next) =>
              commit({ [key]: next } as Partial<SharedSpatialAudioState>)
            }
          />
        ))}
      </div>

      <DndContext onDragEnd={onDragEnd}>
        <div
          ref={mapRef}
          // Panning and dragging avatars must not swipe the phone drawer.
          data-base-ui-swipe-ignore=""
          className="relative h-[360px] touch-none overflow-hidden rounded-lg border border-line bg-ply-2"
          onWheel={onWheel}
          onPointerDown={onMapPointerDown}
          onPointerMove={onMapPointerMove}
          onPointerUp={stopMapPan}
          onPointerCancel={stopMapPan}
        >
          <div
            ref={worldRef}
            className="absolute inset-0 cursor-grab bg-[linear-gradient(var(--line)_1px,transparent_1px),linear-gradient(90deg,var(--line)_1px,transparent_1px)] active:cursor-grabbing"
            style={{
              backgroundSize: `${Math.max(38, 78 / totalZoom)}px ${Math.max(38, 78 / totalZoom)}px`,
              transform: `translate(${view.panX}px, ${view.panY}px) scale(${totalZoom})`,
              transformOrigin: "50% 58%",
            }}
          >
            <div className="absolute left-4 top-4 rounded-sm border border-line bg-ply-3 px-1.5 py-0.5 text-ui-xs font-medium text-ink-2">
              <Num>{state.roomSize}</Num> m² room
            </div>
            {participants.map((participant) => {
              const caps =
                participant.userId === (localUserId || "self")
                  ? {
                      enabled: localSpatialEnabled,
                      highFidelity: localHighFidelity,
                    }
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
          <div className="absolute right-3 top-3 flex rounded-md border border-line bg-ply-3">
            <button
              type="button"
              aria-label="Zoom out"
              onClick={() =>
                setView((current) => ({
                  ...current,
                  zoom: Math.max(0.65, current.zoom - 0.12),
                }))
              }
              className={cn(
                "flex size-8 items-center justify-center text-ink-3 pointer-fine:hover:text-ink-1",
                PRESS,
                HIT,
              )}
            >
              <Icon name="minus" size="sm" />
            </button>
            <button
              type="button"
              aria-label={`Reset zoom, now ${Math.round(totalZoom * 100)}%`}
              onClick={() => setView({ zoom: 1, panX: 0, panY: 0 })}
              className={cn(
                "border-x border-line px-2 text-ui-xs font-medium text-ink-2 pointer-fine:hover:text-ink-1",
                PRESS,
                HIT,
              )}
            >
              <Num>{Math.round(totalZoom * 100)}%</Num>
            </button>
            <button
              type="button"
              aria-label="Zoom in"
              onClick={() =>
                setView((current) => ({
                  ...current,
                  zoom: Math.min(1.8, current.zoom + 0.12),
                }))
              }
              className={cn(
                "flex size-8 items-center justify-center text-ink-3 pointer-fine:hover:text-ink-1",
                PRESS,
                HIT,
              )}
            >
              <Icon name="add" size="sm" />
            </button>
          </div>
          {state.placementMode === "manual" && (
            <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-sm border border-line bg-ply-3 px-1.5 py-0.5 text-ui-xs text-ink-2">
              <Icon name="move" size="xs" /> Drag members to reposition everyone
            </div>
          )}
        </div>
      </DndContext>
    </ResponsivePopover>
  );
}
