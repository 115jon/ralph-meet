/**
 * Shared shell for the floating players: Now Playing, stream previews and the
 * soundboard manager.
 *
 *  - Parks in a corner, inside the safe area and clear of the chrome marked
 *    `data-floating-avoid` (composer, tab bar, voice dock) and of the
 *    headers pinned to the top of the window (8px under them). Players
 *    sharing a corner stack instead of covering each other.
 *  - Ply-3 at radius 12 with a line and the float shadow. It enters with a
 *    fade and scale(.97) from its corner (200ms ease-out), never a loop.
 *  - Drag anywhere that isn't a control (touch or mouse); a flick carries on
 *    and snaps to the nearest corner. The move handle doubles as the
 *    keyboard and single-tap alternative (arrows pick a corner, a click moves
 *    it clockwise).
 *  - Desktop: a header with title and minimise, and an edge to resize.
 *  - Phone: a compact pill; tap it for a bottom sheet with the full controls.
 *  - Minimised: a 48px bubble; tap to restore.
 *  - Corner, minimised state and width persist per player.
 */

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { PRESS } from "@/components/ui/interaction";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useMounted } from "@/hooks/useMounted";
import { cn } from "@/lib/utils";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import {
  avoidInsetsForColumn,
  clampWidth,
  cornerForArrow,
  cornerPosition,
  FLOATING_GAP,
  type FloatingCorner,
  isLeftCorner,
  isTopCorner,
  nextCorner,
  type Point,
  readFloatingPrefs,
  releaseVelocity,
  rubberBand,
  type Size,
  snapCorner,
  writeFloatingPrefs,
} from "./floating-geometry";

/* ------------------------------------------------------------------ */
/* Corner stacking: players sharing a corner sit one above the other    */
/* ------------------------------------------------------------------ */

type StackEntry = { corner: FloatingCorner; height: number; order: number };
const stack = new Map<string, StackEntry>();
const stackListeners = new Set<() => void>();
let stackOrder = 0;
let stackVersion = 0;

function publishStack(id: string, entry: Omit<StackEntry, "order"> | null) {
  const current = stack.get(id);
  if (!entry) {
    if (!current) return;
    stack.delete(id);
  } else {
    if (
      current &&
      current.corner === entry.corner &&
      current.height === entry.height
    ) {
      return;
    }
    stack.set(id, { ...entry, order: current?.order ?? stackOrder++ });
  }
  stackVersion += 1;
  stackListeners.forEach((listener) => listener());
}

function subscribeStack(listener: () => void) {
  stackListeners.add(listener);
  return () => stackListeners.delete(listener);
}

function stackOffsetFor(id: string, corner: FloatingCorner) {
  const self = stack.get(id);
  if (!self) return 0;
  let offset = 0;
  for (const [otherId, other] of stack) {
    if (otherId === id || other.corner !== corner) continue;
    if (other.order < self.order) offset += other.height + FLOATING_GAP;
  }
  return offset;
}

/* ------------------------------------------------------------------ */
/* Viewport, safe areas and chrome to avoid                             */
/* ------------------------------------------------------------------ */

function readSafeArea(name: string) {
  if (typeof document === "undefined") return 0;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(`--safe-area-${name}`)
    .trim();
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readViewport(): Size {
  if (typeof window === "undefined") return { width: 1280, height: 800 };
  const vv = window.visualViewport;
  return {
    width: vv?.width ?? window.innerWidth,
    height: vv?.height ?? window.innerHeight,
  };
}

/**
 * Chrome to stay clear of: anything marked `data-floating-avoid`, plus the
 * headers pinned to the top of the window (title bar, channel and voice
 * headers), so a top-corner player sits 8px under the header instead of
 * over its search and buttons.
 */
function readAvoidElements(): HTMLElement[] {
  if (typeof document === "undefined") return [];
  const marked = Array.from(
    document.querySelectorAll<HTMLElement>("[data-floating-avoid]"),
  );
  const headers = Array.from(
    document.querySelectorAll<HTMLElement>("header"),
  ).filter(
    (el) => !el.closest("[data-floating-surface], [role='dialog'], article"),
  );
  return [...marked, ...headers];
}

/** How far from the top a header may start and still count as top chrome. */
const TOP_CHROME_REACH = 40;
const TOP_CHROME_MAX_HEIGHT = 96;

function readAvoidRects(safeTop = 0) {
  return readAvoidElements()
    .map((el) => ({
      rect: el.getBoundingClientRect(),
      header:
        el.tagName === "HEADER" && !el.hasAttribute("data-floating-avoid"),
    }))
    .filter(
      ({ rect, header }) =>
        rect.width > 0 &&
        rect.height > 0 &&
        (!header ||
          (rect.top <= safeTop + TOP_CHROME_REACH &&
            rect.height <= TOP_CHROME_MAX_HEIGHT)),
    )
    .map(({ rect }) => rect);
}

/** Top edge clear of headers; sides and bottom clear of the screen edge. */
const BASE_TOP = 64;
const EDGE = { phone: 12, desktop: 16 };

interface Layout {
  viewport: Size;
  safe: { top: number; right: number; bottom: number; left: number };
  avoid: ReturnType<typeof readAvoidRects>;
}

function readLayout(): Layout {
  const safe = {
    top: readSafeArea("top"),
    right: readSafeArea("right"),
    bottom: readSafeArea("bottom"),
    left: readSafeArea("left"),
  };
  return { viewport: readViewport(), safe, avoid: readAvoidRects(safe.top) };
}

function positionFor(
  corner: FloatingCorner,
  size: Size,
  layout: Layout,
  phone: boolean,
  stackOffset: number,
): Point {
  const edge = phone ? EDGE.phone : EDGE.desktop;
  const left = layout.safe.left + edge;
  const right = layout.safe.right + edge;
  const columnLeft = isLeftCorner(corner)
    ? left
    : layout.viewport.width - right - size.width;
  const { top, bottom } = avoidInsetsForColumn(
    layout.avoid,
    { left: columnLeft, right: columnLeft + size.width },
    layout.viewport,
    { top: layout.safe.top + BASE_TOP, bottom: layout.safe.bottom + edge },
  );
  return cornerPosition(
    corner,
    size,
    layout.viewport,
    { top, right, bottom, left },
    stackOffset,
  );
}

const INTERACTIVE =
  "button, a, input, select, textarea, [role='slider'], [role='menuitem'], [data-floating-no-drag]";
const DRAG_THRESHOLD = 6;

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

export interface FloatingSurfaceProps {
  /** Persistence and stacking key; one per player. */
  id: string;
  /** Accessible name of the player region, and the header title. */
  label: string;
  title?: ReactNode;
  defaultCorner?: FloatingCorner;
  /** Desktop width range in px; the edge handle resizes within it. */
  width: { min: number; max: number; default: number };
  /** Phone compact width in px (clamped to the screen). */
  phoneWidth?: number;
  minimizeLabel?: string;
  restoreLabel?: string;
  /** Minimised bubble face (icon, artwork). */
  bubble: ReactNode;
  /** Phone compact face. Tapping anything but its controls opens the sheet. */
  compact: ReactNode;
  /** Phone sheet body. */
  sheet: ReactNode;
  sheetTitle?: string;
  sheetDescription?: string;
  /** Extra header buttons on desktop (before minimise). */
  headerActions?: ReactNode;
  /** Desktop body. */
  children: ReactNode;
  testId?: string;
  className?: string;
  onContextMenu?: (event: React.MouseEvent<HTMLDivElement>) => void;
  /** Rendered next to the surface (menus anchored to it). */
  overlay?: ReactNode;
  /** Render in place instead of portalling to body (tests). */
  portal?: boolean;
}

export function FloatingSurface({
  id,
  label,
  title,
  defaultCorner = "bottom-right",
  width: widthRange,
  phoneWidth = 260,
  minimizeLabel = `Minimise ${label.toLowerCase()}`,
  restoreLabel = `Open ${label.toLowerCase()}`,
  bubble,
  compact,
  sheet,
  sheetTitle = label,
  sheetDescription,
  headerActions,
  children,
  testId,
  className,
  onContextMenu,
  overlay,
  portal = true,
}: FloatingSurfaceProps) {
  const mounted = useMounted();
  const phone = useIsMobile();
  const hintId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  const [prefs, setPrefs] = useState(() =>
    readFloatingPrefs(id, {
      corner: defaultCorner,
      minimized: false,
      width: widthRange.default,
    }),
  );
  const updatePrefs = useCallback(
    (patch: Partial<typeof prefs>) => {
      setPrefs((current) => {
        const next = { ...current, ...patch };
        writeFloatingPrefs(id, next);
        return next;
      });
    },
    [id],
  );

  const [sheetOpen, setSheetOpen] = useState(false);
  const [size, setSize] = useState<Size | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [dragging, setDragging] = useState(false);
  const [placed, setPlaced] = useState(false);
  useSyncExternalStore(
    subscribeStack,
    () => stackVersion,
    () => 0,
  );

  const desktopWidth = clampWidth(
    prefs.width ?? widthRange.default,
    widthRange,
  );
  const mode: "bubble" | "compact" | "full" = prefs.minimized
    ? "bubble"
    : phone
      ? "compact"
      : "full";

  // Measure without forcing layout on mount: ResizeObserver reports after
  // the browser has laid out anyway.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") {
      setSize({ width: el.offsetWidth, height: el.offsetHeight });
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const box = entry.borderBoxSize?.[0];
      setSize({
        width: box?.inlineSize ?? entry.contentRect.width,
        height: box?.blockSize ?? entry.contentRect.height,
      });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [mounted, mode]);

  // Viewport, safe areas and avoided chrome: re-read when any of them move.
  useEffect(() => {
    if (!mounted) return;
    let frame = 0;
    const refresh = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setLayout(readLayout()));
    };
    refresh();
    window.addEventListener("resize", refresh);
    window.visualViewport?.addEventListener("resize", refresh);
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(refresh);
    readAvoidElements().forEach((el) => observer?.observe(el));
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", refresh);
      window.visualViewport?.removeEventListener("resize", refresh);
      observer?.disconnect();
    };
  }, [mounted, mode, prefs.corner]);

  useEffect(() => {
    if (!size) return;
    publishStack(id, { corner: prefs.corner, height: size.height });
  }, [id, prefs.corner, size]);
  useEffect(() => () => publishStack(id, null), [id]);

  const position =
    size && layout
      ? positionFor(
          prefs.corner,
          size,
          layout,
          phone,
          stackOffsetFor(id, prefs.corner),
        )
      : null;

  useEffect(() => {
    if (!position || placed) return;
    // Let the first placement land without a transition, then animate.
    const frame = requestAnimationFrame(() => setPlaced(true));
    return () => cancelAnimationFrame(frame);
  }, [position, placed]);

  // Minimise and restore swap the face under the user's focus: move focus
  // to the new face's main control instead of dropping it to <body>.
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    rootRef.current
      ?.querySelector<HTMLElement>("[data-floating-focus]")
      ?.focus({ preventScroll: true });
  }, [mode]);

  /* ---------------- drag ---------------- */

  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: Point;
    size: Size;
    moved: boolean;
    samples: Array<{ t: number; x: number; y: number }>;
    current: Point;
  } | null>(null);
  const suppressClick = useRef(false);

  const writeTransform = (point: Point) => {
    const el = rootRef.current;
    if (el) el.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
  };

  // Moves and the release are read from window: before the drag threshold
  // there is no pointer capture (so taps still click the right child), and a
  // quick first move can leave the surface entirely.
  const detachWindow = useRef<(() => void) | null>(null);
  useEffect(() => () => detachWindow.current?.(), []);

  const handlePointerMove = (event: PointerEvent) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const view = layout?.viewport ?? readViewport();
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      state.moved = true;
      setDragging(true);
      rootRef.current?.setPointerCapture?.(event.pointerId);
    }
    state.samples.push({
      t: performance.now(),
      x: event.clientX,
      y: event.clientY,
    });
    if (state.samples.length > 12) state.samples.shift();
    const next = {
      x: rubberBand(state.origin.x + dx, 0, view.width - state.size.width),
      y: rubberBand(state.origin.y + dy, 0, view.height - state.size.height),
    };
    state.current = next;
    writeTransform(next);
  };

  const endDrag = (event: PointerEvent, cancelled: boolean) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    detachWindow.current?.();
    const root = rootRef.current;
    if (root?.hasPointerCapture?.(event.pointerId)) {
      root.releasePointerCapture?.(event.pointerId);
    }
    if (!state.moved) return;
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    setDragging(false);
    if (cancelled) {
      if (position) writeTransform(position);
      return;
    }
    const corner = snapCorner(
      state.current,
      state.size,
      releaseVelocity(state.samples),
      layout?.viewport ?? readViewport(),
    );
    updatePrefs({ corner });
    // Re-read chrome: the target corner may sit over a different column.
    setLayout(readLayout());
    if (corner === prefs.corner && position) writeTransform(position);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // One finger drives; a second touch mid-drag is ignored.
    if (drag.current) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (!event.currentTarget.contains(target)) return;
    const onHandle = target.closest("[data-floating-handle]");
    if (!onHandle && target.closest(INTERACTIVE)) return;
    const rect = position ? null : event.currentTarget.getBoundingClientRect();
    const origin = position ?? { x: rect!.left, y: rect!.top };
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin,
      size: size ?? { width: rect!.width, height: rect!.height },
      moved: false,
      samples: [{ t: performance.now(), x: event.clientX, y: event.clientY }],
      current: origin,
    };
    const onMove = (e: PointerEvent) => handlePointerMove(e);
    const onUp = (e: PointerEvent) => endDrag(e, false);
    const onCancel = (e: PointerEvent) => endDrag(e, true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    detachWindow.current = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      detachWindow.current = null;
    };
  };

  const handleClickCapture = (event: React.MouseEvent) => {
    if (!suppressClick.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClick.current = false;
  };

  /* ---------------- keyboard / single-pointer move ---------------- */

  const moveHandleProps = {
    "data-floating-handle": "",
    "aria-describedby": hintId,
    onKeyDown: (event: React.KeyboardEvent) => {
      const corner = cornerForArrow(prefs.corner, event.key);
      if (!corner) return;
      event.preventDefault();
      updatePrefs({ corner });
    },
  };

  /* ---------------- desktop resize edge ---------------- */

  const resize = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const growsLeft = !isLeftCorner(prefs.corner);
  const setWidth = (next: number) =>
    updatePrefs({ width: clampWidth(next, widthRange) });

  const resizeHandle = (
    <div
      role="slider"
      tabIndex={0}
      aria-label={`${label} width`}
      aria-orientation="horizontal"
      aria-valuemin={widthRange.min}
      aria-valuemax={widthRange.max}
      aria-valuenow={desktopWidth}
      aria-valuetext={`${desktopWidth} pixels`}
      data-floating-no-drag=""
      onKeyDown={(event) => {
        const step = event.shiftKey ? 60 : 20;
        const grow = growsLeft ? "ArrowLeft" : "ArrowRight";
        const shrink = growsLeft ? "ArrowRight" : "ArrowLeft";
        if (event.key === grow || event.key === "ArrowUp") {
          setWidth(desktopWidth + step);
        } else if (event.key === shrink || event.key === "ArrowDown") {
          setWidth(desktopWidth - step);
        } else if (event.key === "Home") {
          setWidth(widthRange.min);
        } else if (event.key === "End") {
          setWidth(widthRange.max);
        } else {
          return;
        }
        event.preventDefault();
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        resize.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: desktopWidth,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        const state = resize.current;
        if (!state || state.pointerId !== event.pointerId) return;
        const dx = event.clientX - state.startX;
        setWidth(state.startWidth + (growsLeft ? -dx : dx));
      }}
      onPointerUp={(event) => {
        resize.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }}
      onPointerCancel={() => {
        resize.current = null;
      }}
      className={cn(
        "group/resize absolute inset-y-3 z-10 flex w-3 cursor-ew-resize touch-none items-center justify-center outline-none",
        growsLeft ? "-left-1.5" : "-right-1.5",
      )}
    >
      <span
        aria-hidden
        className="h-8 w-1 rounded-full bg-line-strong opacity-0 transition-opacity duration-(--dur-2) ease-out group-focus-visible/resize:opacity-100 pointer-fine:group-hover/resize:opacity-100"
      />
    </div>
  );

  if (!mounted) return null;

  const style: CSSProperties = {
    transform: position
      ? `translate3d(${position.x}px, ${position.y}px, 0)`
      : undefined,
    width:
      mode === "full"
        ? desktopWidth
        : mode === "compact"
          ? `min(${phoneWidth}px, calc(100vw - 24px))`
          : undefined,
  };

  const surfaceShell =
    "rounded-xl border border-line bg-ply-3 text-ink-1 shadow-float";
  // Presence (spec §6): fade + scale(.97) from the docked corner, 200ms
  // ease-out. Transparent (not `visibility: hidden`, so the controls stay
  // in the accessibility tree) for the frame it takes to measure; a face
  // that swaps in later (minimise, restore) starts from the same state.
  const presence = cn(
    "transition-[opacity,scale] duration-(--dur-3) ease-out starting:scale-(--motion-scale-in) starting:opacity-0",
    isTopCorner(prefs.corner)
      ? isLeftCorner(prefs.corner)
        ? "origin-top-left"
        : "origin-top-right"
      : isLeftCorner(prefs.corner)
        ? "origin-bottom-left"
        : "origin-bottom-right",
    position ? "" : "scale-(--motion-scale-in) opacity-0",
  );

  let face: ReactNode;
  if (mode === "bubble") {
    face = (
      <button
        type="button"
        aria-label={restoreLabel}
        aria-describedby={hintId}
        data-floating-handle=""
        data-floating-focus=""
        onClick={() => {
          refocus.current = true;
          updatePrefs({ minimized: false });
        }}
        onKeyDown={moveHandleProps.onKeyDown}
        className={cn(
          "relative flex size-12 touch-none items-center justify-center overflow-hidden rounded-full border border-line bg-ply-3 text-ink-2 shadow-float outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
          PRESS,
          presence,
        )}
      >
        {bubble}
      </button>
    );
  } else if (mode === "compact") {
    face = (
      <div
        className={cn(surfaceShell, "touch-none overflow-hidden", presence)}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
          setSheetOpen(true);
        }}
      >
        {compact}
        <button
          type="button"
          data-floating-focus=""
          className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:inset-0 focus-visible:rounded-xl focus-visible:outline-2 focus-visible:outline-focus"
          onClick={() => setSheetOpen(true)}
        >
          Show {label.toLowerCase()} controls
        </button>
      </div>
    );
  } else {
    face = (
      <section
        aria-label={label}
        className={cn(surfaceShell, "relative", presence)}
      >
        <header className="flex h-10 touch-none items-center gap-1 border-b border-line px-1.5">
          <IconButton
            {...moveHandleProps}
            icon="dragHandle"
            size={28}
            variant="muted"
            aria-label={`Move ${label.toLowerCase()}`}
            onClick={() => updatePrefs({ corner: nextCorner(prefs.corner) })}
            className="cursor-grab active:cursor-grabbing"
          />
          <span className="min-w-0 flex-1 truncate text-ui-sm font-semibold text-ink-1">
            {title ?? label}
          </span>
          {headerActions}
          <IconButton
            icon="minimize"
            size={28}
            variant="muted"
            aria-label={minimizeLabel}
            tooltip="Minimise"
            data-floating-focus=""
            onClick={() => {
              refocus.current = true;
              updatePrefs({ minimized: true });
            }}
          />
        </header>
        <div className="overflow-hidden rounded-b-[inherit]">{children}</div>
        {resizeHandle}
      </section>
    );
  }

  const content = (
    <TooltipProvider>
      <div
        ref={rootRef}
        data-testid={testId}
        data-floating-surface={id}
        data-corner={prefs.corner}
        data-mode={mode}
        data-dragging={dragging || undefined}
        className={cn(
          // touch-none only on the faces that drag (header, pill, bubble):
          // the bodies keep touch scrolling (soundboard list, sliders).
          "fixed top-0 left-0 z-30 select-none",
          dragging ? "cursor-grabbing" : "",
          // Corner to corner is on-screen movement: --ease-in-out.
          placed && !dragging
            ? "transition-transform duration-(--dur-4) ease-in-out"
            : "",
          className,
        )}
        style={style}
        onPointerDown={handlePointerDown}
        onLostPointerCapture={(event) => {
          // Touch starts with implicit capture on the inner target; moving it
          // to this root fires (and bubbles) lostpointercapture from there.
          if (event.target !== event.currentTarget) return;
          if (drag.current?.pointerId !== event.pointerId) return;
          if (drag.current.moved) setDragging(false);
          drag.current = null;
          detachWindow.current?.();
        }}
        onClickCapture={handleClickCapture}
        onContextMenu={onContextMenu}
      >
        <span id={hintId} className="sr-only">
          Drag to move, or use the arrow keys to send it to another corner.
        </span>
        {face}
        {overlay}
      </div>
      {mode === "compact" ? (
        <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
          <DrawerContent aria-label={sheetTitle}>
            <DrawerHeader className="text-left">
              <DrawerTitle>{sheetTitle}</DrawerTitle>
              {sheetDescription ? (
                <DrawerDescription>{sheetDescription}</DrawerDescription>
              ) : null}
            </DrawerHeader>
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4">
              {sheet}
            </div>
            <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-[max(16px,var(--safe-area-bottom,0px))]">
              <CornerPicker
                label={label}
                corner={prefs.corner}
                onPick={(corner) => updatePrefs({ corner })}
              />
              <button
                type="button"
                onClick={() => {
                  refocus.current = true;
                  updatePrefs({ minimized: true });
                  setSheetOpen(false);
                }}
                className={cn(
                  "flex min-h-11 items-center gap-2 rounded-md bg-tint-1 px-3 text-ui-sm font-medium text-ink-1 outline-none focus-visible:outline-2 focus-visible:outline-focus",
                  PRESS,
                )}
              >
                <Icon name="minimize" size="sm" />
                Minimise
              </button>
            </div>
          </DrawerContent>
        </Drawer>
      ) : null}
    </TooltipProvider>
  );

  return portal ? createPortal(content, document.body) : content;
}

const CORNER_LABELS: Record<FloatingCorner, string> = {
  "top-left": "Top left",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
};

/** Four corner buttons: the tap-only way to move a player on a phone. */
function CornerPicker({
  label,
  corner,
  onPick,
}: {
  label: string;
  corner: FloatingCorner;
  onPick: (corner: FloatingCorner) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`${label} position`}
      className="grid grid-cols-2 gap-1 rounded-md bg-tint-1 p-1"
    >
      {(["top-left", "top-right", "bottom-left", "bottom-right"] as const).map(
        (option) => {
          const checked = option === corner;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={CORNER_LABELS[option]}
              onClick={() => onPick(option)}
              className={cn(
                "flex h-10 w-12 rounded-sm p-1.5 outline-none focus-visible:outline-2 focus-visible:outline-focus",
                checked ? "bg-tint-3" : "",
                isTopCorner(option) ? "items-start" : "items-end",
                isLeftCorner(option) ? "justify-start" : "justify-end",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "h-3 w-4 rounded-xs",
                  checked ? "bg-ink-1" : "bg-ink-3",
                )}
              />
            </button>
          );
        },
      )}
    </div>
  );
}
