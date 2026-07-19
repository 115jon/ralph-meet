import { AvatarFrameEditor } from "@/components/chat/AvatarFrameEditor";
import {
  AvatarPickerModal,
  type AvatarUploadItem,
} from "@/components/chat/AvatarPickerModal";
import { ProfileDisplayName } from "@/components/chat/ProfileDisplayName";
import {
  PROFILE_SURFACE_ASPECT_RATIO,
  ProfilePreviewWidgetCard,
  ProfileSurfaceBackdrop,
} from "@/components/chat/ProfilePreviewPrimitives";
import { AvatarImage } from "@/components/chat/AvatarImage";
import { CollectiblesCatalogModal } from "@/components/chat/CollectiblesCatalogModal";
import { ProfileCollectiblesLayer } from "@/components/chat/ProfileCollectiblesLayer";
import { ProfileFrameLayer } from "@/components/chat/ProfileFrameLayer";
import { ProfileSurfaceShell } from "@/components/chat/ProfileSurfaceShell";
import { ProfileAssetLayer } from "@/components/chat/ProfileAssetLayer";
import { UserNameplateLayer } from "@/components/chat/UserNameplateLayer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiUpload,
} from "@/lib/api-client";
import {
  getAvatarCollectibles,
  normalizeAvatarDisplay,
  serializeAvatarDisplay,
  type AvatarCollectibles,
  type AvatarDisplay,
} from "@/lib/avatar-display";
import type { CollectibleKind } from "@/lib/collectibles-catalog";
import { getDisplayInitial } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import { resolveProfileReferenceDate } from "@/lib/profile-dates";
import {
  applyProfileThemeDefaults,
  DEFAULT_PROFILE_THEME,
  createRandomDisplayNameStyle,
  DEFAULT_DISPLAY_NAME_STYLE,
  DISPLAY_NAME_COLOR_SWATCHES,
  DISPLAY_NAME_EFFECT_OPTIONS,
  DISPLAY_NAME_FONT_OPTIONS,
  getContrastTextColor,
  hexToHsv,
  hsvToHex,
  normalizeDisplayNameStyle,
  normalizeHexColor,
  PROFILE_COLOR_SWATCHES,
  resolveProfileTheme,
  type DisplayNameStyle,
} from "@/lib/profile-customization";
import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import { useUser } from "@kova/react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronsRight,
  Crop,
  Loader2,
  Moon,
  Paintbrush,
  Pencil,
  Pipette,
  Plus,
  ShoppingBag,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  UserRoundCheck,
  X,
} from "lucide-react";
import { clog } from "@/lib/console-logger";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

const log = clog("Profile");

const COLLECTIBLE_DISPLAY_KEYS: Record<
  CollectibleKind,
  keyof AvatarCollectibles
> = {
  avatar_decoration: "avatarDecoration",
  profile_effect: "profileEffect",
  nameplate: "nameplate",
  profile_frame: "profileFrame",
};

type JoinedMemberPreview = {
  user: User;
  roles?: unknown[];
  joined_at?: string | number | null;
};

type ClaimCandidate = {
  id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  avatar_display?: AvatarDisplay | string | null;
  match_method: string;
};

type AssetPreview = {
  url: string;
  contentType: string;
};

type CollectibleApplyUser = {
  avatar_display: AvatarDisplay | null;
  nameplate_url: string | null;
  nameplate_content_type: string | null;
  updated_at: string | null;
};

const SETTINGS_TOOLTIP_CONTENT_CLASS =
  "bg-rm-bg-floating border border-rm-border text-rm-text-primary text-[12px] font-bold shadow-xl px-3 py-2 rounded-lg";
const SHOW_LEGACY_PREVIEW_IDENTITY = false;
const COLOR_PICKER_HUE_GRADIENT =
  "linear-gradient(90deg, #FF0000 0%, #FFFF00 16.66%, #00FF00 33.33%, #00FFFF 50%, #0000FF 66.66%, #FF00FF 83.33%, #FF0000 100%)";
const COLOR_PICKER_EMPTY_PATTERN =
  "linear-gradient(45deg, rgba(255,255,255,0.08) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.08) 75%), linear-gradient(45deg, rgba(255,255,255,0.08) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.08) 75%)";
const DISPLAY_NAME_FONT_TILE_SAMPLE = "Ag";
const FOCUSABLE_CONTROL_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");
const DISPLAY_NAME_STYLE_COLOR_POPOVER_SELECTOR =
  "[data-display-name-style-color-popover='true']";

type EyeDropperApi = {
  open: () => Promise<{ sRGBHex: string }>;
};

type EyeDropperWindow = Window & {
  EyeDropper?: new () => EyeDropperApi;
};

function createAssetPreview(file: File): AssetPreview {
  return {
    url: URL.createObjectURL(file),
    contentType: file.type || "application/octet-stream",
  };
}

function clampColorPickerValue(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isBackgroundImageValue(value: string) {
  return /(?:gradient|url)\(/i.test(value);
}

function getPickerSurfaceStyle({
  fill,
  showEmptyPattern = false,
  patternSize,
  patternPosition,
}: {
  fill?: string | null;
  showEmptyPattern?: boolean;
  patternSize?: string;
  patternPosition?: string;
}): CSSProperties {
  const style: CSSProperties = {};
  const normalizedFill = fill?.trim();

  if (normalizedFill) {
    if (isBackgroundImageValue(normalizedFill)) {
      style.backgroundImage = normalizedFill;
    } else {
      style.backgroundColor = normalizedFill;
    }
  }

  if (showEmptyPattern) {
    style.backgroundColor =
      normalizedFill && !isBackgroundImageValue(normalizedFill)
        ? normalizedFill
        : (style.backgroundColor ?? "#111216");
    style.backgroundImage = COLOR_PICKER_EMPTY_PATTERN;
    if (patternSize) {
      style.backgroundSize = patternSize;
    }
    if (patternPosition) {
      style.backgroundPosition = patternPosition;
    }
  }

  return style;
}

function areDisplayNameStylesEqual(
  left: DisplayNameStyle | string | null | undefined,
  right: DisplayNameStyle | string | null | undefined,
) {
  const leftStyle = normalizeDisplayNameStyle(left);
  const rightStyle = normalizeDisplayNameStyle(right);

  if (!leftStyle || !rightStyle) {
    return leftStyle === rightStyle;
  }

  return JSON.stringify(leftStyle) === JSON.stringify(rightStyle);
}

function getFocusableElements(container: ParentNode | null | undefined) {
  if (!container) return [];

  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_CONTROL_SELECTOR),
  ).filter(
    (element) =>
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0,
  );
}

function getDialogFocusableElements(dialog: HTMLElement) {
  const auxiliaryRoots =
    typeof document === "undefined"
      ? []
      : Array.from(
          document.querySelectorAll<HTMLElement>(
            DISPLAY_NAME_STYLE_COLOR_POPOVER_SELECTOR,
          ),
        );

  return Array.from(
    new Set(
      [dialog, ...auxiliaryRoots].flatMap((root) => getFocusableElements(root)),
    ),
  );
}

function AccountActionIconButton({
  label,
  onClick,
  children,
  disabled = false,
  className,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={onClick}
          disabled={disabled}
          className={cn(
            "h-6 w-6 rounded-md border-rm-border bg-rm-bg-floating/92 text-rm-text-muted shadow-[0_8px_18px_rgba(0,0,0,0.28)] backdrop-blur-sm hover:bg-rm-bg-hover hover:text-rm-text md:h-7 md:w-7",
            className,
          )}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={10}
        className={SETTINGS_TOOLTIP_CONTENT_CLASS}
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function ProfileRailSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 text-[10px] font-semibold tracking-[0.08em] text-rm-text-muted/88">
        {title}
      </div>
      {children}
    </section>
  );
}

function ProfileRailCard({
  children,
  actions,
  className,
  onHoverChange,
}: {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  onHoverChange?: (hovered: boolean) => void;
}) {
  return (
    <div
      className={cn(
        "group/rail relative overflow-hidden rounded-[14px] border border-rm-border/80 bg-rm-bg-surface/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_14px_28px_rgba(0,0,0,0.22)] transition duration-200 hover:border-rm-border hover:bg-rm-bg-elevated/80",
        className,
      )}
      onPointerEnter={onHoverChange ? () => onHoverChange(true) : undefined}
      onPointerLeave={onHoverChange ? () => onHoverChange(false) : undefined}
    >
      {actions ? (
        <div className="absolute right-1.5 top-1.5 z-20 flex items-center gap-1 opacity-100 transition duration-200 md:opacity-0 md:group-hover/rail:opacity-100 md:group-focus-within/rail:opacity-100">
          {actions}
        </div>
      ) : null}
      {children}
    </div>
  );
}

function ProfileActionMenu({
  actions,
  anchorRef,
  restoreFocusRef,
  placement = "below",
  portal = false,
  onRequestClose,
}: {
  actions: Array<{
    label: string;
    onClick: () => void;
    destructive?: boolean;
  }>;
  anchorRef?: RefObject<HTMLElement | null>;
  restoreFocusRef?: RefObject<HTMLElement | null>;
  placement?: "below" | "right";
  portal?: boolean;
  onRequestClose?: () => void;
}) {
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const trigger = restoreFocusRef?.current ?? anchorRef?.current;
    const firstAction =
      menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]');
    firstAction?.focus();

    return () => {
      trigger?.focus();
    };
  }, [anchorRef, restoreFocusRef]);

  useLayoutEffect(() => {
    if (!portal || !anchorRef?.current) return;

    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const left = placement === "right" ? rect.right + 8 : rect.left;
      const top = placement === "right" ? rect.top : rect.bottom + 8;
      setPosition({
        left: Math.max(8, Math.min(left, window.innerWidth - 228)),
        top: Math.max(8, Math.min(top, window.innerHeight - 220)),
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchorRef, placement, portal]);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const actions = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        '[role="menuitem"]',
      ),
    );
    const activeIndex = actions.indexOf(
      document.activeElement as HTMLButtonElement,
    );

    if (event.key === "Escape") {
      event.preventDefault();
      onRequestClose?.();
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex =
      (activeIndex + direction + actions.length) % actions.length;
    actions[nextIndex]?.focus();
  };

  const menu = (
    <div
      ref={menuRef}
      onPointerDown={portal ? (event) => event.stopPropagation() : undefined}
      onKeyDown={handleMenuKeyDown}
      role="menu"
      className={cn(
        portal
          ? "fixed z-[2000]"
          : "absolute left-[calc(100%+8px)] top-1 z-[180] max-md:left-1/2 max-md:top-[calc(100%+8px)] max-md:-translate-x-1/2",
        "min-w-[198px] rounded-[12px] border border-rm-border bg-rm-bg-floating p-1.5 shadow-[0_18px_44px_rgba(0,0,0,0.42)] animate-in fade-in zoom-in-95 duration-150",
      )}
      style={portal ? position : undefined}
    >
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          onClick={action.onClick}
          className={cn(
            "flex w-full items-center rounded-lg px-3 py-2 text-left text-[13px] font-semibold transition-colors",
            action.destructive
              ? "text-rose-300 hover:bg-rose-500/12 hover:text-rose-200"
              : "text-rm-text hover:bg-rm-bg-hover",
          )}
        >
          {action.label}
        </button>
      ))}
    </div>
  );

  return portal && typeof document !== "undefined"
    ? createPortal(menu, document.body)
    : menu;
}

function ColorField({
  label,
  value,
  onChange,
  presets,
  helperText,
  defaultColor = "#5865F2",
  previewBackground,
  containerClassName,
  popoverSide = "bottom",
  renderTrigger,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  presets: readonly string[];
  helperText?: string;
  defaultColor?: string;
  previewBackground?: string;
  containerClassName?: string;
  popoverSide?: "top" | "bottom";
  renderTrigger?: (input: {
    open: boolean;
    toggleOpen: () => void;
    value: string | null;
    resolvedColor: string;
    triggerBackground: string;
    triggerTextColor: string;
    popoverId: string;
  }) => ReactNode;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const [open, setOpen] = useState(false);
  const [eyeDropperPending, setEyeDropperPending] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const hexInputRef = useRef<HTMLInputElement | null>(null);
  const saturationRef = useRef<HTMLDivElement | null>(null);
  const hueRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);
  const [popoverPosition, setPopoverPosition] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const labelId = useId();
  const helperTextId = useId();
  const popoverId = useId();
  const eyedropperHintId = useId();
  const saturationInstructionsId = useId();
  const resolvedColor =
    normalizeHexColor(value) ?? normalizeHexColor(defaultColor) ?? "#5865F2";
  const hsv = hexToHsv(resolvedColor);
  const triggerBackground = value ?? previewBackground ?? resolvedColor;
  const triggerTextColor = value ? getContrastTextColor(value) : "#F8FAFC";
  const toggleOpen = () => setOpen((current) => !current);
  const supportsEyeDropper =
    typeof window !== "undefined" &&
    Boolean((window as EyeDropperWindow).EyeDropper);

  const updatePopoverPosition = useCallback(() => {
    if (typeof window === "undefined" || !pickerRef.current) return;

    const rect = pickerRef.current.getBoundingClientRect();
    const viewportPadding = 8;
    const gap = 12;
    const popoverWidth = Math.min(
      320,
      Math.max(260, window.innerWidth - viewportPadding * 2),
    );
    const measuredHeight = popoverRef.current?.offsetHeight ?? 372;
    const availableBottom = window.innerHeight - rect.bottom - viewportPadding;
    const availableTop = rect.top - viewportPadding;

    let preferredSide = popoverSide;
    if (
      popoverSide === "bottom" &&
      availableBottom < measuredHeight &&
      availableTop > availableBottom
    ) {
      preferredSide = "top";
    } else if (
      popoverSide === "top" &&
      availableTop < measuredHeight &&
      availableBottom > availableTop
    ) {
      preferredSide = "bottom";
    }

    const unclampedLeft = rect.left;
    const maxLeft = Math.max(
      viewportPadding,
      window.innerWidth - popoverWidth - viewportPadding,
    );
    const left = clampColorPickerValue(unclampedLeft, viewportPadding, maxLeft);
    const unclampedTop =
      preferredSide === "top"
        ? rect.top - measuredHeight - gap
        : rect.bottom + gap;
    const maxTop = Math.max(
      viewportPadding,
      window.innerHeight - measuredHeight - viewportPadding,
    );
    const top = clampColorPickerValue(unclampedTop, viewportPadding, maxTop);

    setPopoverPosition({ left, top, width: popoverWidth });
  }, [popoverSide]);

  const setColorValue = useCallback(
    (nextValue: string | null) => {
      const normalized = normalizeHexColor(nextValue);
      if (!normalized) {
        setDraft("");
        onChange(null);
        return;
      }

      setDraft(normalized);
      onChange(normalized);
    },
    [onChange],
  );

  const commitDraft = useCallback(() => {
    if (!draft.trim()) {
      setDraft("");
      onChange(null);
      return;
    }

    const normalized = normalizeHexColor(draft);
    if (normalized) {
      setColorValue(normalized);
      return;
    }

    setDraft(value ?? "");
  }, [draft, onChange, setColorValue, value]);

  const updateSaturationFromPointer = (clientX: number, clientY: number) => {
    const rect = saturationRef.current?.getBoundingClientRect();
    if (!rect) return;

    const nextSaturation = clampColorPickerValue(
      (clientX - rect.left) / rect.width,
      0,
      1,
    );
    const nextValue = clampColorPickerValue(
      1 - (clientY - rect.top) / rect.height,
      0,
      1,
    );
    setColorValue(hsvToHex(hsv.h, nextSaturation, nextValue));
  };

  const updateHueFromPointer = (clientX: number) => {
    const rect = hueRef.current?.getBoundingClientRect();
    if (!rect) return;

    const hueProgress = clampColorPickerValue(
      (clientX - rect.left) / rect.width,
      0,
      1,
    );
    const nextHue = hueProgress * 360;
    setColorValue(hsvToHex(nextHue, hsv.s, hsv.v));
  };

  const handleSaturationKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    const step = event.shiftKey ? 0.1 : 0.02;

    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        setColorValue(
          hsvToHex(hsv.h, clampColorPickerValue(hsv.s - step, 0, 1), hsv.v),
        );
        break;
      case "ArrowRight":
        event.preventDefault();
        setColorValue(
          hsvToHex(hsv.h, clampColorPickerValue(hsv.s + step, 0, 1), hsv.v),
        );
        break;
      case "ArrowUp":
        event.preventDefault();
        setColorValue(
          hsvToHex(hsv.h, hsv.s, clampColorPickerValue(hsv.v + step, 0, 1)),
        );
        break;
      case "ArrowDown":
        event.preventDefault();
        setColorValue(
          hsvToHex(hsv.h, hsv.s, clampColorPickerValue(hsv.v - step, 0, 1)),
        );
        break;
      case "Home":
        event.preventDefault();
        setColorValue(hsvToHex(hsv.h, 0, hsv.v));
        break;
      case "End":
        event.preventDefault();
        setColorValue(hsvToHex(hsv.h, 1, hsv.v));
        break;
      default:
        break;
    }
  };

  const handleHueKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 30 : 10;

    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        event.preventDefault();
        setColorValue(hsvToHex(hsv.h - step, hsv.s, hsv.v));
        break;
      case "ArrowRight":
      case "ArrowUp":
        event.preventDefault();
        setColorValue(hsvToHex(hsv.h + step, hsv.s, hsv.v));
        break;
      case "Home":
        event.preventDefault();
        setColorValue(hsvToHex(0, hsv.s, hsv.v));
        break;
      case "End":
        event.preventDefault();
        setColorValue(hsvToHex(360, hsv.s, hsv.v));
        break;
      default:
        break;
    }
  };

  const startDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
    onMove: (clientX: number, clientY: number) => void,
  ) => {
    event.preventDefault();
    onMove(event.clientX, event.clientY);

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      onMove(pointerEvent.clientX, pointerEvent.clientY);
    };
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const handleEyeDropperPick = useCallback(async () => {
    const EyeDropperConstructor =
      typeof window !== "undefined"
        ? (window as EyeDropperWindow).EyeDropper
        : undefined;

    if (!EyeDropperConstructor || eyeDropperPending) return;

    setEyeDropperPending(true);
    try {
      const eyeDropper = new EyeDropperConstructor();
      const result = await eyeDropper.open();
      setColorValue(result.sRGBHex);
    } catch {
      // User cancelled or browser denied the selection.
    } finally {
      setEyeDropperPending(false);
    }
  }, [eyeDropperPending, setColorValue]);

  useLayoutEffect(() => {
    if (!open) {
      setPopoverPosition(null);
      return undefined;
    }

    updatePopoverPosition();
    const rafId = window.requestAnimationFrame(updatePopoverPosition);
    const handleViewportChange = () => updatePopoverPosition();

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, updatePopoverPosition]);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        pickerRef.current?.contains(event.target as Node) ||
        popoverRef.current?.contains(event.target as Node)
      )
        return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    let rafId: number | null = null;

    if (open) {
      rafId = window.requestAnimationFrame(() => {
        hexInputRef.current?.focus();
      });
    } else if (wasOpenRef.current) {
      pickerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }

    wasOpenRef.current = open;
    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [open]);

  const popoverContent =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            id={popoverId}
            ref={popoverRef}
            role="dialog"
            aria-modal="false"
            aria-label={`${label} color picker`}
            data-display-name-style-color-popover="true"
            className="fixed z-[1450] w-[calc(100vw-1rem)] max-w-[320px] rounded-[24px] border border-rm-border bg-rm-bg-floating/96 p-4 text-rm-text shadow-[0_32px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl"
            style={{
              left: popoverPosition?.left ?? 8,
              top: popoverPosition?.top ?? 8,
              width: popoverPosition?.width,
              visibility: popoverPosition ? "visible" : "hidden",
            }}
          >
            <p id={saturationInstructionsId} className="sr-only">
              Use left and right arrow keys to adjust saturation. Use up and
              down arrow keys to adjust brightness.
            </p>
            <div
              ref={saturationRef}
              onPointerDown={(event) =>
                startDrag(event, updateSaturationFromPointer)
              }
              onKeyDown={handleSaturationKeyDown}
              tabIndex={0}
              role="group"
              aria-roledescription="2D color picker"
              className="relative h-[160px] cursor-crosshair overflow-hidden rounded-[18px] border border-rm-border"
              style={{ background: `hsl(${hsv.h} 100% 50%)` }}
              aria-label={`${label} saturation and brightness picker`}
              aria-describedby={saturationInstructionsId}
            >
              <div className="absolute inset-0 bg-[linear-gradient(90deg,#FFFFFF,rgba(255,255,255,0))]" />
              <div className="absolute inset-0 bg-[linear-gradient(0deg,#000000,rgba(0,0,0,0))]" />
              <div
                className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.22),0_4px_16px_rgba(0,0,0,0.4)]"
                style={{
                  left: `${hsv.s * 100}%`,
                  top: `${(1 - hsv.v) * 100}%`,
                  background: resolvedColor,
                }}
              />
            </div>

            <div
              ref={hueRef}
              onPointerDown={(event) =>
                startDrag(event, (clientX) => updateHueFromPointer(clientX))
              }
              onKeyDown={handleHueKeyDown}
              tabIndex={0}
              role="slider"
              aria-orientation="horizontal"
              aria-valuemin={0}
              aria-valuemax={360}
              aria-valuenow={Math.round(hsv.h)}
              aria-valuetext={`${Math.round(hsv.h)} degrees`}
              className="relative mt-4 h-4 cursor-ew-resize overflow-hidden rounded-full border border-rm-border"
              style={{ background: COLOR_PICKER_HUE_GRADIENT }}
              aria-label={`${label} hue picker`}
            >
              <div
                className="pointer-events-none absolute top-1/2 h-5 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-transparent shadow-[0_0_0_1px_rgba(0,0,0,0.2)]"
                style={{ left: `${(hsv.h / 360) * 100}%` }}
              />
            </div>

            <div className="mt-4">
              <div className="flex items-center gap-2 rounded-[14px] border border-primary/35 bg-rm-bg-surface px-2.5 py-2 shadow-[0_0_0_1px_rgba(88,101,242,0.12)]">
                <div
                  className="h-8 w-8 shrink-0 rounded-[10px] border border-rm-border"
                  aria-hidden="true"
                  style={getPickerSurfaceStyle({
                    fill: value,
                    showEmptyPattern: !value,
                    patternSize: "14px 14px",
                    patternPosition: "0 0, 7px 7px",
                  })}
                />
                <span className="shrink-0 text-[18px] font-medium text-rm-text-muted">
                  #
                </span>
                <Input
                  ref={hexInputRef}
                  value={draft.startsWith("#") ? draft.slice(1) : draft}
                  onChange={(event) =>
                    setDraft(
                      event.target.value.startsWith("#")
                        ? event.target.value
                        : `#${event.target.value}`,
                    )
                  }
                  onBlur={commitDraft}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      commitDraft();
                      event.currentTarget.blur();
                    }
                    if (event.key === "Escape") {
                      setDraft(value ?? "");
                      setOpen(false);
                      event.currentTarget.blur();
                    }
                  }}
                  className="h-8 border-0 bg-transparent px-1 py-0 text-[15px] font-medium tracking-[0.04em] text-rm-text shadow-none placeholder:text-rm-text-muted focus-visible:ring-0"
                  placeholder={resolvedColor.slice(1)}
                  spellCheck={false}
                  aria-label={`${label} hex color value`}
                  aria-describedby={eyedropperHintId}
                />
                <button
                  type="button"
                  onClick={handleEyeDropperPick}
                  disabled={!supportsEyeDropper || eyeDropperPending}
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-rm-border bg-rm-bg-elevated text-rm-text-muted transition hover:bg-rm-bg-hover hover:text-rm-text",
                    (!supportsEyeDropper || eyeDropperPending) &&
                      "cursor-not-allowed opacity-45",
                  )}
                  aria-label="Pick color from screen"
                  aria-describedby={eyedropperHintId}
                  title={
                    supportsEyeDropper
                      ? "Pick color from screen"
                      : "Eyedropper unavailable in this browser"
                  }
                >
                  {eyeDropperPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Pipette size={14} />
                  )}
                </button>
              </div>

              <div className="mt-2 flex items-center justify-between gap-3 px-1">
                <div
                  id={eyedropperHintId}
                  className="text-[11px] text-rm-text-muted"
                >
                  {!value
                    ? "Using the app default until you pick a custom color."
                    : supportsEyeDropper
                      ? "Sample any color on screen."
                      : "Eyedropper is not available here."}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setDraft("");
                    onChange(null);
                  }}
                  className="h-7 rounded-[10px] px-2.5 text-[11px] font-semibold text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
                  aria-label={`Use the default ${label.toLowerCase()}`}
                >
                  Use default
                </Button>
              </div>
            </div>

            <div
              className="mt-4 grid grid-cols-5 gap-2"
              role="group"
              aria-label={`${label} preset colors`}
            >
              {presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setColorValue(preset)}
                  className={cn(
                    "h-9 rounded-[12px] border transition duration-150 hover:-translate-y-[1px]",
                    value === preset
                      ? "border-white/90 shadow-[0_0_0_1px_rgba(255,255,255,0.25)]"
                      : "border-white/10",
                  )}
                  style={{ background: preset }}
                  aria-label={`Select ${label.toLowerCase()} preset ${preset}`}
                  aria-pressed={value === preset}
                />
              ))}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      ref={pickerRef}
      className={cn(
        "relative",
        open && "z-[220]",
        !renderTrigger && "space-y-3",
        containerClassName,
      )}
    >
      {renderTrigger ? (
        renderTrigger({
          open,
          toggleOpen,
          value,
          resolvedColor,
          triggerBackground,
          triggerTextColor,
          popoverId,
        })
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div
                id={labelId}
                className="text-[12px] font-semibold text-rm-text"
              >
                {label}
              </div>
              {helperText ? (
                <div
                  id={helperTextId}
                  className="mt-1 text-[11px] text-rm-text-muted"
                >
                  {helperText}
                </div>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            onClick={toggleOpen}
            className="group relative block h-[46px] w-full overflow-hidden rounded-[16px] border border-rm-border bg-rm-bg-surface shadow-[0_16px_30px_rgba(0,0,0,0.24)] transition hover:-translate-y-[1px] hover:border-white/14"
            aria-labelledby={labelId}
            aria-describedby={helperText ? helperTextId : undefined}
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-controls={popoverId}
          >
            <div
              className="absolute inset-0"
              style={getPickerSurfaceStyle({
                fill: triggerBackground,
                showEmptyPattern: !value && !previewBackground,
                patternSize: "16px 16px",
                patternPosition: "0 0, 8px 8px",
              })}
            />
            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.12),rgba(255,255,255,0.02)_42%,rgba(0,0,0,0.22))]" />
            <div className="relative flex h-full items-center justify-between gap-3 px-4">
              <div className="min-w-0 text-left">
                <div
                  className="truncate text-[13px] font-semibold"
                  style={{ color: triggerTextColor }}
                >
                  {value ?? "Auto"}
                </div>
                <div
                  className="mt-0.5 text-[11px]"
                  style={{
                    color: value
                      ? `${triggerTextColor}CC`
                      : "rgba(248,250,252,0.76)",
                  }}
                >
                  {value ? "Custom color" : "Using generated fallback"}
                </div>
              </div>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] border border-white/18 bg-black/18 text-white/86 backdrop-blur-md transition group-hover:bg-black/24">
                <Pipette size={14} />
              </div>
            </div>
          </button>
        </>
      )}
      {popoverContent}
    </div>
  );
}

function DisplayNameStyleDialog({
  open,
  displayName,
  username,
  initialStyle,
  profileThemeStyle,
  avatarSrc,
  avatarDisplay,
  bannerUrl,
  bannerContentType,
  nameplateUrl,
  nameplateContentType,
  profileThemeBackgroundColor,
  profileThemeTextColor,
  onClose,
  onApply,
}: {
  open: boolean;
  displayName: string;
  username: string;
  initialStyle: DisplayNameStyle | string | null;
  profileThemeStyle: CSSProperties;
  avatarSrc?: string | null;
  avatarDisplay?: AvatarDisplay | string | null;
  bannerUrl?: string | null;
  bannerContentType?: string | null;
  nameplateUrl?: string | null;
  nameplateContentType?: string | null;
  profileThemeBackgroundColor?: string | null;
  profileThemeTextColor?: string | null;
  onClose: () => void;
  onApply: (style: DisplayNameStyle | null) => void;
}) {
  const [draftStyle, setDraftStyle] = useState<DisplayNameStyle>(
    () => normalizeDisplayNameStyle(initialStyle) ?? DEFAULT_DISPLAY_NAME_STYLE,
  );
  const [activeColorSlot, setActiveColorSlot] = useState<
    "primary" | "secondary"
  >("primary");
  const actualProfileThemeMode = profileThemeBackgroundColor
    ? getContrastTextColor(profileThemeBackgroundColor) === "#12131A"
      ? "light"
      : "dark"
    : null;
  const [previewMode, setPreviewMode] = useState<"dark" | "light">(
    () => actualProfileThemeMode ?? "dark",
  );
  const useActualProfileThemePreview =
    Boolean(profileThemeBackgroundColor) &&
    actualProfileThemeMode === previewMode;
  const previewSurfaceBackground = useActualProfileThemePreview
    ? (profileThemeBackgroundColor ??
      (previewMode === "dark" ? "#0C0F14" : "#FBF4EE"))
    : previewMode === "dark"
      ? "#0C0F14"
      : "#FBF4EE";
  const previewSurfaceText = useActualProfileThemePreview
    ? (profileThemeTextColor ??
      (previewMode === "dark" ? "#F8FAFC" : "#1D2430"))
    : previewMode === "dark"
      ? "#F8FAFC"
      : "#1D2430";
  const chatPreviewBackground = previewMode === "dark" ? "#151922" : "#FFFFFF";
  const chatPreviewText = previewMode === "dark" ? "#F8FAFC" : "#1D2430";
  const dialogRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const fontSectionId = useId();
  const effectSectionId = useId();
  const colorSectionId = useId();
  const previewRegionId = useId();
  const previewModeSectionId = useId();

  const applyPresetColor = useCallback(
    (preset: string) => {
      setDraftStyle((prev) => ({
        ...prev,
        [activeColorSlot === "primary" ? "primaryColor" : "secondaryColor"]:
          preset,
      }));
    },
    [activeColorSlot],
  );

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const rafId = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;

      const [firstFocusable] = getDialogFocusableElements(dialog);
      (firstFocusable ?? dialog).focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (document.querySelector(DISPLAY_NAME_STYLE_COLOR_POPOVER_SELECTOR))
          return;
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = getDialogFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const activeElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      if (!activeElement || !focusable.includes(activeElement)) {
        event.preventDefault();
        (event.shiftKey
          ? focusable[focusable.length - 1]
          : focusable[0]
        )?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(rafId);
      document.removeEventListener("keydown", handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/58 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="presentation"
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionId}
        tabIndex={-1}
        className="grid w-full max-w-[920px] max-h-[min(760px,calc(100dvh-1.5rem))] gap-0 overflow-hidden rounded-[30px] border border-rm-border bg-rm-bg-elevated text-rm-text shadow-[0_32px_96px_rgba(0,0,0,0.48)] outline-none lg:grid-cols-[minmax(0,308px)_minmax(0,1fr)]"
      >
        <div className="overflow-y-auto border-b border-rm-border p-4 lg:border-b-0 lg:border-r lg:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2
                id={dialogTitleId}
                className="text-xl font-semibold text-rm-text"
              >
                Change display name style
              </h2>
              <p id={dialogDescriptionId} className="sr-only">
                Choose a font, effect, and colors, then review the preview
                before you apply your display name style.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              className="rounded-xl border border-rm-border bg-rm-bg-surface/70 text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
              aria-label="Close display name style dialog"
            >
              <X size={16} />
            </Button>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <h3
                id={fontSectionId}
                className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-rm-text-muted"
              >
                Choose font
              </h3>
              <div
                className="grid grid-cols-4 gap-2"
                role="group"
                aria-labelledby={fontSectionId}
              >
                {DISPLAY_NAME_FONT_OPTIONS.map((option) => (
                  <Tooltip key={option.id}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() =>
                          setDraftStyle((prev) => ({
                            ...prev,
                            font: option.id,
                          }))
                        }
                        className={cn(
                          "aspect-square min-w-0 rounded-[15px] border p-0 transition hover:-translate-y-[1px]",
                          draftStyle.font === option.id
                            ? "border-primary bg-primary/10 shadow-[0_16px_32px_rgba(88,101,242,0.14)]"
                            : "border-rm-border bg-rm-bg-surface/70 hover:border-rm-border hover:bg-rm-bg-elevated/70",
                        )}
                        aria-label={`Select ${option.label} font`}
                        aria-pressed={draftStyle.font === option.id}
                      >
                        <ProfileDisplayName
                          text={DISPLAY_NAME_FONT_TILE_SAMPLE}
                          displayNameStyle={{
                            ...draftStyle,
                            font: option.id,
                          }}
                          className={cn(
                            "flex h-full items-center justify-center overflow-hidden text-center font-bold leading-none",
                            option.id === "eight-bit"
                              ? "text-[9px] tracking-[0.02em] sm:text-[10px]"
                              : "text-[20px] sm:text-[21px]",
                          )}
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      sideOffset={8}
                      className={SETTINGS_TOOLTIP_CONTENT_CLASS}
                    >
                      {option.label}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>

            <div>
              <h3
                id={effectSectionId}
                className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-rm-text-muted"
              >
                Choose effect
              </h3>
              <div
                className="grid grid-cols-3 gap-2"
                role="group"
                aria-labelledby={effectSectionId}
              >
                {DISPLAY_NAME_EFFECT_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() =>
                      setDraftStyle((prev) => ({ ...prev, effect: option.id }))
                    }
                    className={cn(
                      "aspect-square min-w-0 rounded-[15px] border p-0 transition hover:-translate-y-[1px]",
                      draftStyle.effect === option.id
                        ? "border-primary bg-primary/10 shadow-[0_16px_32px_rgba(88,101,242,0.14)]"
                        : "border-rm-border bg-rm-bg-surface/70 hover:border-rm-border hover:bg-rm-bg-elevated/70",
                    )}
                    aria-label={`Select ${option.label} effect`}
                    aria-pressed={draftStyle.effect === option.id}
                  >
                    <ProfileDisplayName
                      text={option.label}
                      displayNameStyle={{
                        ...draftStyle,
                        font: DEFAULT_DISPLAY_NAME_STYLE.font,
                        effect: option.id,
                      }}
                      className="flex h-full items-center justify-center overflow-hidden px-2 text-center text-[13px] font-semibold sm:text-[14px]"
                    />
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h3
                id={colorSectionId}
                className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-rm-text-muted"
              >
                Choose colors
              </h3>
              <div
                className="rounded-[18px] border border-rm-border bg-rm-bg-surface/60 p-2.5"
                role="group"
                aria-labelledby={colorSectionId}
              >
                <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5">
                  <div className="flex shrink-0 gap-1.5">
                    <ColorField
                      label="Base name color"
                      value={draftStyle.primaryColor}
                      onChange={(value) => {
                        setActiveColorSlot("primary");
                        setDraftStyle((prev) => ({
                          ...prev,
                          primaryColor:
                            value ?? DEFAULT_DISPLAY_NAME_STYLE.primaryColor,
                        }));
                      }}
                      presets={DISPLAY_NAME_COLOR_SWATCHES}
                      defaultColor={DEFAULT_DISPLAY_NAME_STYLE.primaryColor}
                      containerClassName="shrink-0"
                      renderTrigger={({
                        open,
                        toggleOpen,
                        triggerBackground,
                        popoverId,
                      }) => (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveColorSlot("primary");
                            toggleOpen();
                          }}
                          className={cn(
                            "group flex flex-col items-center gap-1",
                            activeColorSlot === "primary" && "text-rm-text",
                          )}
                          aria-label="Choose base name color"
                          aria-expanded={open}
                          aria-controls={popoverId}
                          aria-haspopup="dialog"
                          aria-pressed={activeColorSlot === "primary"}
                        >
                          <span
                            className={cn(
                              "h-9 w-9 rounded-[12px] border border-white/10 shadow-[0_10px_24px_rgba(0,0,0,0.28)] transition group-hover:-translate-y-[1px]",
                              activeColorSlot === "primary"
                                ? "ring-2 ring-primary/70 ring-offset-2 ring-offset-[color:var(--rm-bg-elevated)]"
                                : "ring-1 ring-transparent",
                            )}
                            style={{ background: triggerBackground }}
                          />
                          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-rm-text-muted">
                            Base
                          </span>
                        </button>
                      )}
                    />
                    <ColorField
                      label="Highlight name color"
                      value={draftStyle.secondaryColor}
                      onChange={(value) => {
                        setActiveColorSlot("secondary");
                        setDraftStyle((prev) => ({
                          ...prev,
                          secondaryColor:
                            value ?? DEFAULT_DISPLAY_NAME_STYLE.secondaryColor,
                        }));
                      }}
                      presets={DISPLAY_NAME_COLOR_SWATCHES}
                      defaultColor={DEFAULT_DISPLAY_NAME_STYLE.secondaryColor}
                      containerClassName="shrink-0"
                      renderTrigger={({
                        open,
                        toggleOpen,
                        triggerBackground,
                        popoverId,
                      }) => (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveColorSlot("secondary");
                            toggleOpen();
                          }}
                          className={cn(
                            "group flex flex-col items-center gap-1",
                            activeColorSlot === "secondary" && "text-rm-text",
                          )}
                          aria-label="Choose highlight name color"
                          aria-expanded={open}
                          aria-controls={popoverId}
                          aria-haspopup="dialog"
                          aria-pressed={activeColorSlot === "secondary"}
                        >
                          <span
                            className={cn(
                              "h-9 w-9 rounded-[12px] border border-white/10 shadow-[0_10px_24px_rgba(0,0,0,0.28)] transition group-hover:-translate-y-[1px]",
                              activeColorSlot === "secondary"
                                ? "ring-2 ring-primary/70 ring-offset-2 ring-offset-[color:var(--rm-bg-elevated)]"
                                : "ring-1 ring-transparent",
                            )}
                            style={{ background: triggerBackground }}
                          />
                          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-rm-text-muted">
                            Glow
                          </span>
                        </button>
                      )}
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div
                      className="grid grid-cols-6 gap-1.5"
                      role="group"
                      aria-label={`${activeColorSlot === "primary" ? "Base" : "Highlight"} color presets`}
                    >
                      {DISPLAY_NAME_COLOR_SWATCHES.map((preset) => (
                        <button
                          key={`${activeColorSlot}-${preset}`}
                          type="button"
                          onClick={() => applyPresetColor(preset)}
                          className={cn(
                            "aspect-square w-full rounded-[12px] border transition duration-150 hover:-translate-y-[1px]",
                            (activeColorSlot === "primary"
                              ? draftStyle.primaryColor
                              : draftStyle.secondaryColor) === preset
                              ? "border-white/90 shadow-[0_0_0_1px_rgba(255,255,255,0.25)]"
                              : "border-white/10",
                          )}
                          style={{ background: preset }}
                          aria-label={`Set ${activeColorSlot === "primary" ? "base" : "highlight"} color to ${preset}`}
                          aria-pressed={
                            (activeColorSlot === "primary"
                              ? draftStyle.primaryColor
                              : draftStyle.secondaryColor) === preset
                          }
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          className="flex min-h-[420px] flex-col bg-rm-bg-primary"
          role="region"
          aria-labelledby={previewRegionId}
        >
          <h3 id={previewRegionId} className="sr-only">
            Style preview
          </h3>
          <div className="flex-1 p-4 lg:p-5">
            <div
              className="relative flex min-h-[100%] items-center justify-center overflow-hidden rounded-[26px] border border-[color:var(--rm-profile-custom-card-border)]"
              style={{
                ...profileThemeStyle,
                backgroundColor: previewSurfaceBackground,
                backgroundImage: useActualProfileThemePreview
                  ? "var(--rm-profile-custom-surface)"
                  : "none",
              }}
            >
              {bannerUrl ? (
                <ProfileAssetLayer
                  url={bannerUrl}
                  contentType={bannerContentType}
                  alt=""
                  className="pointer-events-none absolute inset-0 opacity-28"
                />
              ) : null}
              <div
                className="absolute inset-0"
                style={{
                  background: useActualProfileThemePreview
                    ? "var(--rm-profile-custom-surface-overlay-strong)"
                    : previewMode === "dark"
                      ? "linear-gradient(180deg, rgba(7,10,16,0.28), rgba(7,10,16,0.78))"
                      : "linear-gradient(180deg, rgba(255,255,255,0.24), rgba(246,232,222,0.70))",
                }}
              />
              <div className="relative z-10 flex w-full max-w-[430px] flex-col items-center gap-4 px-4 py-6">
                <div
                  className="relative w-full max-w-[318px] overflow-hidden rounded-[28px] border border-[color:var(--rm-profile-custom-card-border)] shadow-[0_24px_60px_rgba(0,0,0,0.26)]"
                  style={{
                    backgroundColor: previewSurfaceBackground,
                    backgroundImage: useActualProfileThemePreview
                      ? "var(--rm-profile-custom-surface)"
                      : "none",
                  }}
                >
                  {bannerUrl ? (
                    <ProfileAssetLayer
                      url={bannerUrl}
                      contentType={bannerContentType}
                      alt=""
                      className="pointer-events-none absolute inset-x-0 top-0 h-[118px]"
                    />
                  ) : (
                    <div
                      className="absolute inset-x-0 top-0 h-[118px]"
                      style={{
                        background: useActualProfileThemePreview
                          ? "var(--rm-profile-custom-banner-fallback)"
                          : previewMode === "dark"
                            ? "linear-gradient(135deg, rgba(88,101,242,0.30), rgba(15,23,42,0.92) 68%)"
                            : "linear-gradient(135deg, rgba(96,165,250,0.30), rgba(255,255,255,0.94) 68%)",
                      }}
                    />
                  )}
                  <div
                    className="absolute inset-x-0 top-0 h-[118px]"
                    style={{
                      background: useActualProfileThemePreview
                        ? "var(--rm-profile-custom-banner-overlay)"
                        : previewMode === "dark"
                          ? "linear-gradient(180deg, rgba(0,0,0,0.06), rgba(0,0,0,0.28))"
                          : "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(0,0,0,0.08))",
                    }}
                  />
                  <div
                    className="absolute inset-0"
                    style={{
                      background: useActualProfileThemePreview
                        ? "var(--rm-profile-custom-surface-overlay-strong)"
                        : previewMode === "dark"
                          ? "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(0,0,0,0.22))"
                          : "linear-gradient(180deg, rgba(255,255,255,0.12), rgba(255,255,255,0.02))",
                    }}
                  />

                  <div className="relative">
                    <div className="h-[118px]" />
                    <div className="relative px-5 pb-5 pt-14">
                      <div className="absolute left-5 top-0 -translate-y-1/2">
                        <div className="relative h-[74px] w-[74px] rounded-full border-[5px] border-[rgba(10,12,18,0.68)] bg-[var(--rm-profile-custom-card-bg-strong)] shadow-[0_14px_34px_rgba(0,0,0,0.30)]">
                          {avatarSrc ? (
                            <AvatarImage
                              src={avatarSrc}
                              alt={displayName}
                              display={avatarDisplay}
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center rounded-full bg-[var(--rm-profile-custom-button-bg)] text-[28px] font-bold text-[color:var(--rm-profile-custom-button-text)]">
                              {displayName.charAt(0).toUpperCase()}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="min-w-0 pt-2">
                        <ProfileDisplayName
                          text={displayName}
                          displayNameStyle={draftStyle}
                          className="block truncate text-[22px] font-semibold tracking-[-0.035em]"
                          backgroundColor={previewSurfaceBackground}
                          readableFallbackColor={previewSurfaceText}
                        />
                        <div className="mt-1 text-[12px] text-[color:var(--rm-profile-custom-muted)]">
                          @{username}
                        </div>
                      </div>

                      <div className="mt-4 flex items-center gap-2">
                        <div className="rounded-[12px] bg-[var(--rm-profile-custom-card-bg-strong)] px-3 py-1.5 text-[12px] font-medium text-[color:var(--rm-profile-custom-text)]">
                          Message
                        </div>
                        <div className="flex h-8 w-8 items-center justify-center rounded-[12px] bg-[var(--rm-profile-custom-card-bg-strong)] text-[color:var(--rm-profile-custom-muted)]">
                          <Plus size={14} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  className="w-full max-w-[340px] rounded-[22px] border px-3.5 py-3 shadow-[0_18px_40px_rgba(0,0,0,0.18)]"
                  style={{
                    borderColor:
                      previewMode === "dark"
                        ? "rgba(255,255,255,0.08)"
                        : "rgba(15,23,42,0.08)",
                    backgroundColor:
                      previewMode === "dark"
                        ? "rgba(21,25,34,0.90)"
                        : "rgba(255,255,255,0.88)",
                    color: chatPreviewText,
                  }}
                >
                  <div className="flex items-start gap-2.5">
                    <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-white/10 bg-rm-bg-elevated">
                      {avatarSrc ? (
                        <AvatarImage
                          src={avatarSrc}
                          alt={displayName}
                          display={avatarDisplay}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-[var(--rm-profile-custom-button-bg)] text-[13px] font-bold text-[color:var(--rm-profile-custom-button-text)]">
                          {displayName.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <ProfileDisplayName
                          text={displayName}
                          displayNameStyle={draftStyle}
                          className="block truncate text-[14px] font-semibold"
                          backgroundColor={chatPreviewBackground}
                          readableFallbackColor={chatPreviewText}
                        />
                        <span
                          className={cn(
                            "text-[11px]",
                            previewMode === "dark"
                              ? "text-white/38"
                              : "text-black/38",
                          )}
                        >
                          10:08 AM
                        </span>
                      </div>
                      <div
                        className={cn(
                          "mt-1 text-[13px]",
                          previewMode === "dark"
                            ? "text-white/78"
                            : "text-black/72",
                        )}
                      >
                        does anyone read this?
                      </div>
                    </div>
                  </div>
                </div>

                <div className="relative w-full max-w-[340px] overflow-hidden rounded-[18px] border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] px-4 py-3 shadow-[0_18px_40px_rgba(0,0,0,0.18)]">
                  {nameplateUrl ? (
                    <UserNameplateLayer
                      nameplateUrl={nameplateUrl}
                      nameplateContentType={nameplateContentType}
                      avatarDisplay={avatarDisplay ?? null}
                      seedId={username}
                      alt=""
                      className="pointer-events-none absolute inset-0 opacity-[0.96]"
                    />
                  ) : null}
                  <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,7,11,0.10),rgba(5,7,11,0.32))]" />
                  <div className="relative z-10 flex items-center gap-3">
                    <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-white/12 bg-rm-bg-elevated">
                      {avatarSrc ? (
                        <AvatarImage
                          src={avatarSrc}
                          alt={displayName}
                          display={avatarDisplay}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-[var(--rm-profile-custom-button-bg)] text-[13px] font-bold text-[color:var(--rm-profile-custom-button-text)]">
                          {displayName.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="relative min-w-0 flex-1">
                      <ProfileDisplayName
                        text={displayName}
                        displayNameStyle={draftStyle}
                        className="relative block min-w-0 flex-1 truncate text-[17px] font-semibold text-[color:var(--rm-profile-custom-text)]"
                        minContrastRatio={2.8}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-rm-border px-4 py-3 sm:gap-4 lg:px-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-[34ch] text-[12px] leading-relaxed text-rm-text-muted">
                Display name colors and effects can shift a little between light
                and dark surfaces.
              </p>
              <div
                className="inline-flex items-center gap-1 rounded-full border border-rm-border bg-rm-bg-surface/70 p-1"
                role="group"
                aria-labelledby={previewModeSectionId}
              >
                <span id={previewModeSectionId} className="sr-only">
                  Preview surface
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewMode("dark")}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full transition",
                    previewMode === "dark"
                      ? "bg-rm-bg-hover text-rm-text shadow-sm"
                      : "text-rm-text-muted hover:text-rm-text",
                  )}
                  aria-label="Show dark preview"
                  aria-pressed={previewMode === "dark"}
                >
                  <Moon size={15} />
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode("light")}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full transition",
                    previewMode === "light"
                      ? "bg-rm-bg-hover text-rm-text shadow-sm"
                      : "text-rm-text-muted hover:text-rm-text",
                  )}
                  aria-label="Show light preview"
                  aria-pressed={previewMode === "light"}
                >
                  <Sun size={15} />
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDraftStyle(createRandomDisplayNameStyle())}
                className="h-11 rounded-xl border border-rm-border bg-rm-bg-surface/70 px-4 text-rm-text hover:bg-rm-bg-hover"
              >
                <Sparkles size={15} />
                Surprise Me
              </Button>
              <div className="flex items-center gap-3">
                {normalizeDisplayNameStyle(initialStyle) ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      onApply(null);
                      onClose();
                    }}
                    className="h-11 rounded-xl border border-rm-border bg-rm-bg-surface/60 px-4 text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
                  >
                    <Trash2 size={15} />
                    Clear style
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onClose}
                  className="h-11 rounded-xl border border-rm-border bg-rm-bg-surface/60 px-4 text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    onApply(draftStyle);
                    onClose();
                  }}
                  className="h-11 rounded-xl bg-primary px-4 text-primary-foreground hover:bg-primary/90"
                >
                  Apply
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function isManagedNameplateUrl(url: string | null | undefined) {
  return (
    typeof url === "string" && url.startsWith("/api/profile-assets/nameplate/")
  );
}

function removeCollectibleFromAvatarDisplay(
  display: AvatarDisplay | string | null,
  kind: CollectibleKind,
): AvatarDisplay | null {
  const normalizedDisplay = normalizeAvatarDisplay(display);
  if (!normalizedDisplay?.collectibles) {
    return normalizedDisplay ?? null;
  }

  switch (kind) {
    case "avatar_decoration": {
      if (!normalizedDisplay.collectibles.avatarDecoration)
        return normalizedDisplay;
      const {
        avatarDecoration: _removedCollectible,
        ...remainingCollectibles
      } = normalizedDisplay.collectibles;
      return {
        ...normalizedDisplay,
        collectibles:
          Object.keys(remainingCollectibles).length > 0
            ? remainingCollectibles
            : undefined,
      } satisfies AvatarDisplay;
    }
    case "profile_effect": {
      if (!normalizedDisplay.collectibles.profileEffect)
        return normalizedDisplay;
      const { profileEffect: _removedCollectible, ...remainingCollectibles } =
        normalizedDisplay.collectibles;
      return {
        ...normalizedDisplay,
        collectibles:
          Object.keys(remainingCollectibles).length > 0
            ? remainingCollectibles
            : undefined,
      } satisfies AvatarDisplay;
    }
    case "nameplate": {
      if (!normalizedDisplay.collectibles.nameplate) return normalizedDisplay;
      const { nameplate: _removedCollectible, ...remainingCollectibles } =
        normalizedDisplay.collectibles;
      return {
        ...normalizedDisplay,
        collectibles:
          Object.keys(remainingCollectibles).length > 0
            ? remainingCollectibles
            : undefined,
      } satisfies AvatarDisplay;
    }
    case "profile_frame": {
      if (!normalizedDisplay.collectibles.profileFrame)
        return normalizedDisplay;
      const { profileFrame: _removedCollectible, ...remainingCollectibles } =
        normalizedDisplay.collectibles;
      return {
        ...normalizedDisplay,
        collectibles:
          Object.keys(remainingCollectibles).length > 0
            ? remainingCollectibles
            : undefined,
      } satisfies AvatarDisplay;
    }
    default:
      return normalizedDisplay;
  }
}

function useAccountState(user: any, chatUser: any) {
  const [displayName, setDisplayName] = useState(
    () =>
      chatUser?.display_name ||
      (user?.unsafeMetadata?.displayName as string) ||
      user?.fullName ||
      user?.firstName ||
      "",
  );
  const [username, setUsername] = useState(
    () => chatUser?.username || user?.username || "",
  );
  const [pronouns, setPronouns] = useState(() => chatUser?.pronouns || "");
  const [bio, setBio] = useState(() => chatUser?.bio || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [selectedAvatarUrl, setSelectedAvatarUrl] = useState<string | null>(
    null,
  );
  const [bannerPreview, setBannerPreview] = useState<AssetPreview | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [nameplatePreview, setNameplatePreview] = useState<AssetPreview | null>(
    null,
  );
  const [nameplateFile, setNameplateFile] = useState<File | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [removeBanner, setRemoveBanner] = useState(false);
  const [removeNameplate, setRemoveNameplate] = useState(false);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const nameplateInputRef = useRef<HTMLInputElement>(null);

  const lastUserId = useRef(user?.id);
  if (user?.id !== lastUserId.current) {
    setDisplayName(
      chatUser?.display_name ||
        (user?.unsafeMetadata?.displayName as string) ||
        user?.fullName ||
        user?.firstName ||
        "",
    );
    setUsername(chatUser?.username || user?.username || "");
    setPronouns(chatUser?.pronouns || "");
    setBio(chatUser?.bio || "");
    setError(null);
    setSaved(false);
    setAvatarPreview(null);
    setAvatarFile(null);
    setSelectedAvatarUrl(null);
    setBannerPreview(null);
    setBannerFile(null);
    setNameplatePreview(null);
    setNameplateFile(null);
    setRemoveAvatar(false);
    setRemoveBanner(false);
    setRemoveNameplate(false);
    lastUserId.current = user?.id;
  }

  return {
    displayName,
    setDisplayName,
    username,
    setUsername,
    pronouns,
    setPronouns,
    bio,
    setBio,
    saving,
    setSaving,
    saved,
    setSaved,
    error,
    setError,
    avatarPreview,
    setAvatarPreview,
    avatarFile,
    setAvatarFile,
    selectedAvatarUrl,
    setSelectedAvatarUrl,
    bannerPreview,
    setBannerPreview,
    bannerFile,
    setBannerFile,
    nameplatePreview,
    setNameplatePreview,
    nameplateFile,
    setNameplateFile,
    removeAvatar,
    setRemoveAvatar,
    removeBanner,
    setRemoveBanner,
    removeNameplate,
    setRemoveNameplate,
    bannerInputRef,
    nameplateInputRef,
  };
}

export default function SettingsAccountTab({
  authUserLoaded = true,
  asModal = false,
  onClose,
}: {
  authUserLoaded?: boolean;
  asModal?: boolean;
  onClose?: () => void;
}) {
  const { user } = useUser();
  const chatUser = useChatStore((s) => s.user);
  const loadCurrentUser = useChatStore((s) => s.actions.loadCurrentUser);
  const updateStatus = useChatStore((s) => s.actions.updateStatus);
  const activeServerId = useChatStore((s) => s.activeServerId);
  const previewMemberRecord = useChatStore(
    (state) =>
      (state.members as JoinedMemberPreview[]).find(
        (member) => member.user.id === state.user?.id,
      ) ?? null,
  );

  const {
    displayName,
    setDisplayName,
    username,
    setUsername,
    pronouns,
    setPronouns,
    bio,
    setBio,
    saving,
    setSaving,
    setSaved,
    error,
    setError,
    avatarPreview,
    setAvatarPreview,
    avatarFile,
    setAvatarFile,
    selectedAvatarUrl,
    setSelectedAvatarUrl,
    bannerPreview,
    setBannerPreview,
    bannerFile,
    setBannerFile,
    nameplatePreview,
    setNameplatePreview,
    nameplateFile,
    setNameplateFile,
    removeAvatar,
    setRemoveAvatar,
    removeBanner,
    setRemoveBanner,
    removeNameplate,
    setRemoveNameplate,
    bannerInputRef,
    nameplateInputRef,
  } = useAccountState(user, chatUser);
  const storedProfileTheme = applyProfileThemeDefaults({
    profile_accent_color: chatUser?.profile_accent_color,
    profile_background_color: chatUser?.profile_background_color,
    profile_banner_color: chatUser?.profile_banner_color,
  });
  const [claimCandidates, setClaimCandidates] = useState<ClaimCandidate[]>([]);
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [avatarDisplay, setAvatarDisplay] = useState<
    AvatarDisplay | string | null
  >(() => chatUser?.avatar_display ?? null);
  const [avatarDisplayChanged, setAvatarDisplayChanged] = useState(false);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [bannerPickerOpen, setBannerPickerOpen] = useState(false);
  const [avatarMenuAnchor, setAvatarMenuAnchor] = useState<
    "rail" | "preview" | null
  >(null);
  const avatarMenuOpen = avatarMenuAnchor !== null;
  const avatarMenuRef = useRef<HTMLDivElement | null>(null);
  const avatarPreviewMenuRef = useRef<HTMLDivElement | null>(null);
  const avatarRailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const avatarPreviewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [profileMenuAnchor, setProfileMenuAnchor] = useState<"preview" | null>(
    null,
  );
  const profileMenuOpen = profileMenuAnchor !== null;
  const profilePreviewMenuRef = useRef<HTMLDivElement | null>(null);
  const profileBannerActionRef = useRef<HTMLSpanElement | null>(null);
  const profileBannerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [avatarEditor, setAvatarEditor] = useState<{
    src: string;
    file?: File;
  } | null>(null);
  const [collectiblesKind, setCollectiblesKind] =
    useState<CollectibleKind | null>(null);
  const [profileAccentColor, setProfileAccentColor] = useState<string | null>(
    () => storedProfileTheme.profile_accent_color,
  );
  const [profileBackgroundColor, setProfileBackgroundColor] = useState<
    string | null
  >(() => storedProfileTheme.profile_background_color);
  const [profileBannerColor, setProfileBannerColor] = useState<string | null>(
    () => storedProfileTheme.profile_banner_color,
  );
  const [displayNameStyle, setDisplayNameStyle] =
    useState<DisplayNameStyle | null>(() =>
      normalizeDisplayNameStyle(chatUser?.display_name_style),
    );
  const [displayNameStyleEditorOpen, setDisplayNameStyleEditorOpen] =
    useState(false);
  const [stylesCollapsed, setStylesCollapsed] = useState(false);
  const [isNameplatePreviewHovered, setIsNameplatePreviewHovered] =
    useState(false);
  const [
    isAvatarDecorationPreviewHovered,
    setIsAvatarDecorationPreviewHovered,
  ] = useState(false);
  const [isProfileEffectPreviewHovered, setIsProfileEffectPreviewHovered] =
    useState(false);
  const [activePreviewField, setActivePreviewField] = useState<
    "pronouns" | "bio" | null
  >(null);
  const previewPronounsInputRef = useRef<HTMLInputElement | null>(null);
  const previewBioInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [isCustomStatusEditing, setIsCustomStatusEditing] = useState(false);
  const [customStatusDraft, setCustomStatusDraft] = useState(
    () => chatUser?.custom_status ?? "",
  );
  const previewCustomStatusInputRef = useRef<HTMLInputElement | null>(null);

  const savedDisplayNameStyle = normalizeDisplayNameStyle(
    chatUser?.display_name_style,
  );
  const previewTheme = resolveProfileTheme({
    profile_accent_color: profileAccentColor,
    profile_background_color: profileBackgroundColor,
    profile_banner_color: profileBannerColor,
  });
  const previewThemeStyle = previewTheme.variables;
  const hasDisplayNameStyle = Boolean(displayNameStyle);

  useEffect(() => {
    if (!avatarDisplayChanged && !avatarFile) {
      setAvatarDisplay(chatUser?.avatar_display ?? null);
    }
  }, [avatarDisplayChanged, avatarFile, chatUser?.avatar_display]);

  useEffect(() => {
    if (!isCustomStatusEditing) {
      setCustomStatusDraft(chatUser?.custom_status ?? "");
    }
  }, [chatUser?.custom_status, isCustomStatusEditing]);

  useEffect(() => {
    if (!avatarMenuOpen && !profileMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !avatarMenuRef.current?.contains(target) &&
        !avatarPreviewMenuRef.current?.contains(target) &&
        !profilePreviewMenuRef.current?.contains(target)
      ) {
        setAvatarMenuAnchor(null);
        setProfileMenuAnchor(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAvatarMenuAnchor(null);
        setProfileMenuAnchor(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [avatarMenuOpen, profileMenuOpen]);

  useEffect(() => {
    if (activePreviewField === "pronouns") {
      previewPronounsInputRef.current?.focus();
      previewPronounsInputRef.current?.select();
      return;
    }

    if (activePreviewField === "bio") {
      previewBioInputRef.current?.focus();
      previewBioInputRef.current?.select();
    }
  }, [activePreviewField]);

  useEffect(() => {
    if (!isCustomStatusEditing) return;

    previewCustomStatusInputRef.current?.focus();
    previewCustomStatusInputRef.current?.select();
  }, [isCustomStatusEditing]);

  useEffect(() => {
    let cancelled = false;
    setClaimLoading(true);
    setClaimError(null);
    apiGet<{ claimed: boolean; candidates: ClaimCandidate[] }>(
      "/api/account-claims",
    )
      .then((data) => {
        if (!cancelled) setClaimCandidates(data.claimed ? [] : data.candidates);
      })
      .catch((err) => {
        if (!cancelled)
          setClaimError(
            err instanceof Error
              ? err.message
              : "Unable to check claimable accounts.",
          );
      })
      .finally(() => {
        if (!cancelled) setClaimLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (!avatarPreview?.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(avatarPreview);
  }, [avatarPreview]);

  useEffect(() => {
    if (!bannerPreview?.url.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(bannerPreview.url);
  }, [bannerPreview]);

  useEffect(() => {
    if (!nameplatePreview?.url.startsWith("blob:")) return;
    return () => URL.revokeObjectURL(nameplatePreview.url);
  }, [nameplatePreview]);

  const hasChanges =
    pronouns !== (chatUser?.pronouns || "") ||
    bio !== (chatUser?.bio || "") ||
    avatarFile !== null ||
    selectedAvatarUrl !== null ||
    removeAvatar ||
    avatarDisplayChanged ||
    bannerFile !== null ||
    nameplateFile !== null ||
    removeBanner ||
    removeNameplate ||
    storedProfileTheme.profile_accent_color !== profileAccentColor ||
    storedProfileTheme.profile_background_color !== profileBackgroundColor ||
    storedProfileTheme.profile_banner_color !== profileBannerColor ||
    !areDisplayNameStylesEqual(displayNameStyle, savedDisplayNameStyle);

  const persistedAvatarSrc = chatUser?.avatar_url
    ? getAuthAssetUrl(chatUser.avatar_url)
    : null;
  const fallbackAvatarSrc = user?.imageUrl || undefined;
  const draftAvatarDisplay =
    avatarDisplayChanged || avatarFile
      ? avatarDisplay
      : (chatUser?.avatar_display ?? null);
  const avatarDisplayWithoutCrop = (() => {
    const normalizedDisplay = normalizeAvatarDisplay(draftAvatarDisplay);
    if (!normalizedDisplay?.crop) {
      return normalizedDisplay ?? draftAvatarDisplay;
    }

    return normalizedDisplay.collectibles
      ? ({
          version: 1,
          collectibles: normalizedDisplay.collectibles,
        } satisfies AvatarDisplay)
      : null;
  })();
  const currentAvatarSrc = removeAvatar
    ? fallbackAvatarSrc
    : avatarPreview || persistedAvatarSrc || fallbackAvatarSrc;
  const currentAvatarDisplay = removeAvatar
    ? avatarDisplayWithoutCrop
    : draftAvatarDisplay;
  const currentDisplayName =
    displayName.trim() ||
    chatUser?.display_name ||
    chatUser?.username ||
    user?.username ||
    "Profile";
  const currentUsername =
    username.trim() || chatUser?.username || user?.username || "profile";
  const currentPronouns = pronouns.trim();
  const currentBio = bio.trim();
  const currentCustomStatus = customStatusDraft.trim();
  const visibleCustomStatus =
    currentCustomStatus || chatUser?.custom_status?.trim() || "";
  const hasCustomStatus = Boolean(visibleCustomStatus);
  const currentPresenceStatus = chatUser?.status ?? "online";
  const previewReferenceDate = resolveProfileReferenceDate({
    joinedAt:
      activeServerId && activeServerId !== "@me"
        ? previewMemberRecord?.joined_at
        : null,
    createdAt: chatUser?.created_at ?? user?.createdAt ?? null,
  });
  const currentCollectibles = getAvatarCollectibles(currentAvatarDisplay);
  const currentAvatarDecoration = currentCollectibles?.avatarDecoration;
  const currentProfileEffect = currentCollectibles?.profileEffect;
  const currentProfileFrame = currentCollectibles?.profileFrame;
  const currentNameplateSelection = currentCollectibles?.nameplate;
  const currentProfileEffectDisplay = currentProfileEffect
    ? normalizeAvatarDisplay({
        version: 1,
        collectibles: {
          profileEffect: currentProfileEffect,
        },
      })
    : null;
  const currentProfileFrameDisplay = currentProfileFrame
    ? normalizeAvatarDisplay({
        version: 1,
        collectibles: {
          profileFrame: currentProfileFrame,
        },
      })
    : null;
  const hasPersistedUploadedAvatar = Boolean(
    chatUser?.avatar_url?.startsWith("/api/avatars/"),
  );
  const hasAvatarCrop = Boolean(
    normalizeAvatarDisplay(draftAvatarDisplay)?.crop,
  );
  const hasRemovableAvatar = Boolean(
    avatarFile || avatarPreview || hasPersistedUploadedAvatar || hasAvatarCrop,
  );
  const currentAvatarDisplayWithoutDecoration = (() => {
    const normalizedDisplay = normalizeAvatarDisplay(currentAvatarDisplay);
    if (!normalizedDisplay?.collectibles?.avatarDecoration) {
      return normalizedDisplay ?? currentAvatarDisplay;
    }

    const { avatarDecoration: _avatarDecoration, ...remainingCollectibles } =
      normalizedDisplay.collectibles;
    return {
      ...normalizedDisplay,
      collectibles:
        Object.keys(remainingCollectibles).length > 0
          ? remainingCollectibles
          : undefined,
    } satisfies AvatarDisplay;
  })();

  const currentBannerUrl = removeBanner
    ? null
    : bannerPreview?.url || chatUser?.banner_url || null;
  const currentBannerContentType = removeBanner
    ? null
    : bannerPreview?.contentType || chatUser?.banner_content_type || null;
  const currentNameplateUrl = removeNameplate
    ? null
    : nameplatePreview?.url || chatUser?.nameplate_url || null;
  const currentNameplateContentType = removeNameplate
    ? null
    : nameplatePreview?.contentType || chatUser?.nameplate_content_type || null;
  const handleOpenCustomStatusEditor = useCallback(() => {
    setIsCustomStatusEditing(true);
  }, []);
  const handleSaveCustomStatus = useCallback(() => {
    const trimmedStatus = customStatusDraft.trim();
    const persistedStatus = chatUser?.custom_status?.trim() ?? "";

    setIsCustomStatusEditing(false);
    setCustomStatusDraft(trimmedStatus);

    if (trimmedStatus === persistedStatus) {
      return;
    }

    updateStatus(currentPresenceStatus, trimmedStatus || null);
  }, [
    chatUser?.custom_status,
    currentPresenceStatus,
    customStatusDraft,
    updateStatus,
  ]);
  const handleClearCustomStatus = useCallback(() => {
    if (!currentCustomStatus && !chatUser?.custom_status?.trim()) {
      setIsCustomStatusEditing(false);
      return;
    }

    setCustomStatusDraft("");
    setIsCustomStatusEditing(false);
    updateStatus(currentPresenceStatus, null);
  }, [
    chatUser?.custom_status,
    currentCustomStatus,
    currentPresenceStatus,
    updateStatus,
  ]);
  const nameplateStatus = removeNameplate
    ? "Nameplate will be removed when you save."
    : nameplateFile
      ? `Pending upload: ${nameplateFile.name}`
      : currentNameplateSelection?.name
        ? `Selected collectible: ${currentNameplateSelection.name}`
        : currentNameplateUrl
          ? "Custom nameplate active"
          : "No nameplate selected";
  const bannerStatus = removeBanner
    ? "Banner will be removed when you save."
    : bannerFile
      ? `Pending upload: ${bannerFile.name}`
      : currentBannerUrl
        ? "Profile banner active"
        : "No banner selected";
  const nameplateStaticPreviewUrl =
    currentNameplateUrl || currentNameplateSelection?.staticUrl || null;
  const nameplateStaticPreviewContentType = currentNameplateUrl
    ? currentNameplateContentType
    : null;
  const nameplateHoverPreviewUrl =
    currentNameplateUrl ||
    currentNameplateSelection?.animatedUrl ||
    currentNameplateSelection?.staticUrl ||
    null;
  const nameplateHoverPreviewContentType = currentNameplateUrl
    ? currentNameplateContentType
    : currentNameplateSelection?.animatedUrl
      ? "video/mp4"
      : null;
  const avatarDecorationPreviewArtUrl = currentAvatarDecoration?.asset
    ? `https://cdn.discordapp.com/avatar-decoration-presets/${currentAvatarDecoration.asset}.png?size=240&passthrough=true`
    : (currentAvatarDecoration?.imageUrl ?? null);
  const resetDraftState = useCallback(() => {
    setDisplayName(
      chatUser?.display_name ||
        (user?.unsafeMetadata?.displayName as string) ||
        user?.username ||
        "",
    );
    setUsername(chatUser?.username || user?.username || "");
    setPronouns(chatUser?.pronouns || "");
    setBio(chatUser?.bio || "");
    setAvatarFile(null);
    setAvatarPreview(null);
    setSelectedAvatarUrl(null);
    setAvatarDisplay(chatUser?.avatar_display ?? null);
    setAvatarDisplayChanged(false);
    setRemoveAvatar(false);
    setBannerFile(null);
    setBannerPreview(null);
    setNameplateFile(null);
    setNameplatePreview(null);
    setRemoveBanner(false);
    setRemoveNameplate(false);
    setProfileAccentColor(storedProfileTheme.profile_accent_color);
    setProfileBackgroundColor(storedProfileTheme.profile_background_color);
    setProfileBannerColor(storedProfileTheme.profile_banner_color);
    setDisplayNameStyle(
      normalizeDisplayNameStyle(chatUser?.display_name_style),
    );
    setError(null);
    setSaved(false);
  }, [
    chatUser?.avatar_display,
    chatUser?.bio,
    chatUser?.display_name,
    chatUser?.display_name_style,
    storedProfileTheme.profile_accent_color,
    storedProfileTheme.profile_background_color,
    storedProfileTheme.profile_banner_color,
    chatUser?.pronouns,
    chatUser?.username,
    setAvatarDisplay,
    setAvatarDisplayChanged,
    setAvatarFile,
    setAvatarPreview,
    setBannerFile,
    setBannerPreview,
    setBio,
    setDisplayName,
    setError,
    setNameplateFile,
    setNameplatePreview,
    setPronouns,
    setRemoveAvatar,
    setRemoveBanner,
    setRemoveNameplate,
    setSelectedAvatarUrl,
    setSaved,
    setUsername,
    user?.unsafeMetadata?.displayName,
    user?.username,
  ]);

  const syncCollectibleState = useCallback(
    async (
      updatedUser: CollectibleApplyUser,
      appliedKinds: CollectibleKind[],
    ) => {
      const persistedDisplay = normalizeAvatarDisplay(
        updatedUser.avatar_display,
      );
      const draftDisplay = normalizeAvatarDisplay(currentAvatarDisplay);
      const mergedCollectibles: AvatarCollectibles = {
        ...(draftDisplay?.collectibles ?? {}),
      };
      for (const kind of appliedKinds) {
        const key = COLLECTIBLE_DISPLAY_KEYS[kind];
        const nextValue = persistedDisplay?.collectibles?.[key];
        if (nextValue) {
          Object.assign(mergedCollectibles, { [key]: nextValue });
        } else {
          delete mergedCollectibles[key];
        }
      }
      const mergedDisplay = normalizeAvatarDisplay({
        version: 1,
        ...(draftDisplay?.crop ? { crop: draftDisplay.crop } : {}),
        ...(Object.keys(mergedCollectibles).length > 0
          ? { collectibles: mergedCollectibles }
          : {}),
      });
      setAvatarDisplay(mergedDisplay ?? persistedDisplay);
      if (appliedKinds.includes("nameplate")) {
        setRemoveNameplate(false);
        setNameplateFile(null);
        setNameplatePreview(null);
      }
      if (typeof user?.reload === "function") {
        await user.reload();
      }
      await loadCurrentUser();
      setAvatarDisplayChanged(
        Boolean(avatarFile) ||
          JSON.stringify(mergedDisplay) !== JSON.stringify(persistedDisplay),
      );
    },
    [
      avatarFile,
      currentAvatarDisplay,
      loadCurrentUser,
      setAvatarDisplay,
      setAvatarDisplayChanged,
      setNameplateFile,
      setNameplatePreview,
      setRemoveNameplate,
      user,
    ],
  );

  const handleAvatarFile = (file: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file for your avatar.");
      return;
    }
    setSelectedAvatarUrl(null);
    setRemoveAvatar(false);
    const src = URL.createObjectURL(file);
    setAvatarEditor({ src, file });
  };

  const handleRecentAvatarSelect = (item: AvatarUploadItem) => {
    setError(null);
    setAvatarFile(null);
    setRemoveAvatar(false);
    setSelectedAvatarUrl(item.avatar_url);
    setAvatarPreview(getAuthAssetUrl(item.avatar_url));
    setAvatarDisplay(avatarDisplayWithoutCrop);
    setAvatarDisplayChanged(true);
    setAvatarPickerOpen(false);
  };

  const handleEditAvatarFrame = () => {
    if (!currentAvatarSrc) return;
    setAvatarEditor({ src: currentAvatarSrc });
  };

  const handleAvatarFrameCancel = () => {
    if (avatarEditor?.file && avatarEditor.src.startsWith("blob:")) {
      URL.revokeObjectURL(avatarEditor.src);
    }
    setAvatarEditor(null);
  };

  const handleAvatarFrameConfirm = (display: AvatarDisplay) => {
    if (!avatarEditor) return;
    if (avatarEditor.file) {
      setAvatarFile(avatarEditor.file);
      setAvatarPreview(avatarEditor.src);
      setSelectedAvatarUrl(null);
    }
    setRemoveAvatar(false);
    setAvatarDisplay(display);
    setAvatarDisplayChanged(true);
    setAvatarEditor(null);
  };

  const handleRemoveAvatar = useCallback(() => {
    if (!hasRemovableAvatar) return;
    setError(null);
    setAvatarFile(null);
    setAvatarPreview(null);
    setSelectedAvatarUrl(null);
    setRemoveAvatar(true);
    setAvatarDisplayChanged(false);
  }, [
    hasRemovableAvatar,
    setAvatarDisplayChanged,
    setAvatarFile,
    setAvatarPreview,
    setSelectedAvatarUrl,
    setError,
    setRemoveAvatar,
  ]);

  const handleBannerFile = (file: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file for your banner.");
      return;
    }
    setRemoveBanner(false);
    setBannerFile(file);
    setBannerPreview(createAssetPreview(file));
  };

  const handleBannerSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    handleBannerFile(file);
    e.target.value = "";
  };

  const handleNameplateSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRemoveNameplate(false);
    setError(null);
    setNameplateFile(file);
    setNameplatePreview(createAssetPreview(file));
  };

  const handleOpenCollectibles = useCallback(
    (kind: CollectibleKind = "avatar_decoration") => {
      setCollectiblesKind(kind);
    },
    [],
  );

  const handleRemoveCollectible = useCallback(
    (kind: CollectibleKind) => {
      const hasCollectible =
        kind === "avatar_decoration"
          ? Boolean(currentAvatarDecoration)
          : kind === "profile_effect"
            ? Boolean(currentProfileEffect)
            : kind === "profile_frame"
              ? Boolean(currentCollectibles?.profileFrame)
              : Boolean(currentNameplateSelection);
      if (!hasCollectible) {
        return;
      }

      const nextAvatarDisplay = removeCollectibleFromAvatarDisplay(
        currentAvatarDisplay,
        kind,
      );
      setError(null);
      setAvatarDisplay(nextAvatarDisplay);
      setAvatarDisplayChanged(true);
    },
    [
      currentAvatarDecoration,
      currentAvatarDisplay,
      currentCollectibles?.profileFrame,
      currentNameplateSelection,
      currentProfileEffect,
      setAvatarDisplay,
      setAvatarDisplayChanged,
      setError,
    ],
  );

  const handleRemoveNameplate = useCallback(() => {
    const savedNameplateUrl = chatUser?.nameplate_url ?? null;
    if (
      !savedNameplateUrl &&
      !currentNameplateSelection &&
      !nameplateFile &&
      !nameplatePreview
    ) {
      return;
    }

    setError(null);
    setRemoveNameplate(true);
    setNameplateFile(null);
    setNameplatePreview(null);

    if (currentNameplateSelection) {
      const nextAvatarDisplay = removeCollectibleFromAvatarDisplay(
        currentAvatarDisplay,
        "nameplate",
      );
      setAvatarDisplay(nextAvatarDisplay);
      setAvatarDisplayChanged(true);
    }
  }, [
    chatUser?.nameplate_url,
    currentAvatarDisplay,
    currentNameplateSelection,
    nameplateFile,
    nameplatePreview,
    setAvatarDisplay,
    setError,
    setNameplateFile,
    setNameplatePreview,
    setRemoveNameplate,
    setAvatarDisplayChanged,
  ]);

  const handleSaveProfile = useCallback(async () => {
    if (!user) return;
    setSaving(true);
    setSaved(false);
    setError(null);

    const trimmedPronouns = pronouns.trim();
    const trimmedBio = bio.trim();

    try {
      await apiPatch("/api/update-profile", {
        pronouns: trimmedPronouns || null,
        bio: trimmedBio || null,
        profileAccentColor,
        profileBackgroundColor,
        profileBannerColor,
        displayNameStyle,
        ...(removeAvatar ? { removeAvatar: true } : {}),
        ...(!removeAvatar && !avatarFile && selectedAvatarUrl
          ? { avatarUrl: selectedAvatarUrl }
          : {}),
        ...(removeAvatar && currentAvatarDisplay
          ? { avatarDisplay: currentAvatarDisplay }
          : avatarDisplayChanged && !avatarFile
            ? { avatarDisplay }
            : {}),
      });

      if (removeAvatar) {
        setAvatarFile(null);
        setAvatarPreview(null);
        setSelectedAvatarUrl(null);
        setRemoveAvatar(false);
        setAvatarDisplay(currentAvatarDisplay);
        setAvatarDisplayChanged(false);
      } else if (avatarFile) {
        const formData = new FormData();
        formData.append("file", avatarFile);
        const serializedDisplay = serializeAvatarDisplay(avatarDisplay);
        if (serializedDisplay)
          formData.append("avatar_display", serializedDisplay);
        const uploaded = await apiUpload<{
          url: string;
          avatar_display: AvatarDisplay | null;
        }>("/api/avatar-upload", formData);
        setAvatarFile(null);
        setAvatarPreview(null);
        setSelectedAvatarUrl(null);
        setAvatarDisplay(uploaded.avatar_display);
        setAvatarDisplayChanged(false);
      } else if (selectedAvatarUrl) {
        setAvatarDisplayChanged(false);
      } else if (avatarDisplayChanged) {
        setAvatarDisplayChanged(false);
      }

      if (bannerFile) {
        const formData = new FormData();
        formData.append("kind", "banner");
        formData.append("file", bannerFile);
        await apiUpload<{ url: string; content_type: string }>(
          "/api/profile-assets/manage",
          formData,
        );
        setBannerFile(null);
        setBannerPreview(null);
        setRemoveBanner(false);
      } else if (removeBanner && chatUser?.banner_url) {
        await apiDelete<{ ok: true }, { kind: "banner" }>(
          "/api/profile-assets/manage",
          { kind: "banner" },
        );
        setRemoveBanner(false);
      }

      if (nameplateFile) {
        const formData = new FormData();
        formData.append("kind", "nameplate");
        formData.append("file", nameplateFile);
        await apiUpload<{ url: string; content_type: string }>(
          "/api/profile-assets/manage",
          formData,
        );
        setNameplateFile(null);
        setNameplatePreview(null);
        setRemoveNameplate(false);
      } else if (removeNameplate) {
        const savedNameplateUrl = chatUser?.nameplate_url ?? null;
        if (savedNameplateUrl && isManagedNameplateUrl(savedNameplateUrl)) {
          await apiDelete<{ ok: true }, { kind: "nameplate" }>(
            "/api/profile-assets/manage",
            { kind: "nameplate" },
          );
        }
        if (
          !savedNameplateUrl ||
          !isManagedNameplateUrl(savedNameplateUrl) ||
          currentNameplateSelection
        ) {
          const data = await apiPatch<{ ok: true; user: CollectibleApplyUser }>(
            "/api/collectibles/apply",
            {
              kind: "nameplate",
              skuId: null,
              avatarDisplay: currentAvatarDisplay ?? null,
            },
          );
          setAvatarDisplay(data.user.avatar_display);
        }
        setRemoveNameplate(false);
      }

      if (typeof user.reload === "function") {
        await user.reload();
      }
      await loadCurrentUser();
      if (selectedAvatarUrl) {
        setAvatarPreview(null);
        setSelectedAvatarUrl(null);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      log.error("Failed to save:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to save profile. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }, [
    user,
    pronouns,
    bio,
    avatarFile,
    selectedAvatarUrl,
    avatarDisplay,
    avatarDisplayChanged,
    bannerFile,
    currentAvatarDisplay,
    displayNameStyle,
    nameplateFile,
    profileAccentColor,
    profileBackgroundColor,
    profileBannerColor,
    removeAvatar,
    removeBanner,
    removeNameplate,
    chatUser?.banner_url,
    chatUser?.nameplate_url,
    currentNameplateSelection,
    loadCurrentUser,
    setSaving,
    setSaved,
    setError,
    setAvatarPreview,
    setAvatarFile,
    setSelectedAvatarUrl,
    setBannerPreview,
    setBannerFile,
    setNameplatePreview,
    setNameplateFile,
    setRemoveAvatar,
    setRemoveBanner,
    setRemoveNameplate,
  ]);

  const handleClaimAccount = useCallback(
    async (legacyUserId: string) => {
      setClaimingId(legacyUserId);
      setClaimError(null);
      try {
        await apiPost("/api/account-claims", { legacyUserId });
        await loadCurrentUser();
        setClaimCandidates([]);
        window.location.reload();
      } catch (err) {
        setClaimError(
          err instanceof Error ? err.message : "Unable to claim that account.",
        );
      } finally {
        setClaimingId(null);
      }
    },
    [loadCurrentUser],
  );

  if (!user) {
    return (
      <div className="animate-in fade-in slide-in-from-right-4 duration-300">
        <h1 className="text-2xl font-bold text-rm-text mb-6 hidden md:block">
          My Account
        </h1>
        <div className="rounded-xl border border-rm-border bg-rm-bg-surface p-6">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rm-accent/15 text-rm-accent">
              {authUserLoaded ? (
                <AlertTriangle size={18} />
              ) : (
                <Loader2 size={18} className="animate-spin" />
              )}
            </div>
            <div>
              <h2 className="text-sm font-bold text-rm-text">
                {authUserLoaded
                  ? "Account profile unavailable"
                  : "Loading account profile"}
              </h2>
              <p className="mt-1 text-sm leading-6 text-rm-text-secondary">
                {authUserLoaded
                  ? "Your chat session is active, but the auth profile did not load. Other settings are still available."
                  : "We are still resolving your Ralph Auth profile."}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "animate-in fade-in slide-in-from-right-4 duration-300",
        asModal &&
          "relative flex h-full min-h-0 flex-col overflow-hidden bg-rm-bg-primary",
      )}
    >
      {asModal ? (
        onClose ? (
          <div className="pointer-events-none absolute right-5 top-5 z-30">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="pointer-events-auto h-10 w-10 rounded-full border border-rm-border bg-rm-bg-floating/92 text-rm-text-muted shadow-[0_14px_34px_rgba(0,0,0,0.26)] backdrop-blur-md hover:bg-rm-bg-hover hover:text-rm-text"
              aria-label="Close profile editor"
            >
              <X size={18} />
            </Button>
          </div>
        ) : null
      ) : (
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-rm-text">Edit Profile</h1>
          <p className="mt-2 text-sm text-rm-text-muted">
            Update your collectibles and profile surfaces in one place.
          </p>
        </div>
      )}

      <input
        ref={bannerInputRef}
        type="file"
        accept="image/*"
        onChange={handleBannerSelect}
        className="hidden"
        aria-label="Upload profile banner"
      />
      <input
        ref={nameplateInputRef}
        type="file"
        accept="image/*,video/mp4,video/webm,video/ogg"
        onChange={handleNameplateSelect}
        className="hidden"
        aria-label="Upload member nameplate"
      />

      <div
        className={cn(
          asModal
            ? "min-h-0 flex-1 overflow-y-auto bg-rm-bg-primary custom-scrollbar"
            : "bg-transparent",
        )}
      >
        <div
          className={cn(
            asModal
              ? "h-full pb-24 md:pb-28 lg:pb-0"
              : "px-4 pb-6 pt-2 md:px-6 md:pb-8 md:pt-4",
          )}
        >
          {asModal && error ? (
            <div className="m-4 mb-0 flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          ) : null}

          <div
            className={cn(
              "grid gap-6 lg:grid-cols-[228px_minmax(0,1fr)]",
              asModal && "min-h-full gap-0 lg:h-full lg:min-h-0 lg:items-start",
              asModal &&
                (stylesCollapsed
                  ? "lg:grid-cols-[0px_minmax(0,1fr)]"
                  : "lg:grid-cols-[228px_minmax(0,1fr)]"),
            )}
          >
            <aside
              className={cn(
                "self-start transition-[opacity,transform,max-width] duration-300",
                asModal && "relative z-[140] min-h-0",
                !stylesCollapsed && "overflow-visible",
                asModal &&
                  stylesCollapsed &&
                  "pointer-events-none max-w-0 -translate-x-5 opacity-0 overflow-hidden",
              )}
            >
              <div
                className={cn(
                  "bg-rm-bg-primary",
                  asModal
                    ? "overflow-visible border-b border-rm-border/80 lg:h-full lg:border-b-0 lg:border-r"
                    : "overflow-hidden rounded-[22px] border border-rm-border",
                )}
              >
                <div
                  className={cn(
                    "flex items-center justify-between border-b border-rm-border",
                    asModal ? "px-3 py-2.5" : "px-4 py-3.5",
                  )}
                >
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rm-border bg-rm-bg-surface px-2 py-1 text-[13px] font-semibold text-rm-text transition hover:bg-rm-bg-hover"
                  >
                    <span>Main Profile</span>
                    <ChevronDown size={13} className="text-rm-text-muted" />
                  </button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => {
                          if (asModal) setStylesCollapsed(true);
                        }}
                        className="rounded-lg border border-transparent bg-transparent p-1.5 text-rm-text-muted transition hover:border-rm-border hover:bg-rm-bg-hover hover:text-rm-text"
                        aria-label={
                          asModal ? "Hide styles" : "View profile variants"
                        }
                      >
                        <ChevronsRight size={16} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      sideOffset={8}
                      className={SETTINGS_TOOLTIP_CONTENT_CLASS}
                    >
                      {asModal ? "Hide styles" : "View profile variants"}
                    </TooltipContent>
                  </Tooltip>
                </div>

                <div
                  className={cn(
                    "space-y-3",
                    asModal ? "overflow-visible px-3 pb-3 pt-2.5" : "p-4",
                  )}
                >
                  <ProfileRailSection title="Nameplate">
                    <ProfileRailCard
                      className="p-2.5"
                      onHoverChange={setIsNameplatePreviewHovered}
                      actions={
                        <>
                          <AccountActionIconButton
                            label="Browse nameplates"
                            onClick={() => handleOpenCollectibles("nameplate")}
                          >
                            <Sparkles size={12} />
                          </AccountActionIconButton>
                          <AccountActionIconButton
                            label="Upload nameplate"
                            onClick={() => nameplateInputRef.current?.click()}
                          >
                            <Upload size={12} />
                          </AccountActionIconButton>
                          <AccountActionIconButton
                            label="Remove nameplate"
                            onClick={handleRemoveNameplate}
                            disabled={
                              !currentNameplateUrl &&
                              !currentNameplateSelection &&
                              !nameplateFile
                            }
                            className="text-rose-300 hover:bg-rose-500/12 hover:text-rose-100"
                          >
                            <Trash2 size={12} />
                          </AccountActionIconButton>
                        </>
                      }
                    >
                      <div
                        className="relative h-9 overflow-hidden rounded-[10px] border border-rm-border/70 bg-rm-bg-surface"
                        title={nameplateStatus}
                      >
                        {nameplateStaticPreviewUrl ? (
                          <>
                            <div className="absolute inset-0 transition duration-300 group-hover/rail:opacity-0">
                              <UserNameplateLayer
                                nameplateUrl={nameplateStaticPreviewUrl}
                                nameplateContentType={
                                  nameplateStaticPreviewContentType
                                }
                                avatarDisplay={currentAvatarDisplay}
                                seedId={currentUsername}
                                alt="Nameplate preview"
                                className="opacity-95"
                                playVideo={false}
                              />
                            </div>
                            <div className="absolute inset-0 opacity-0 transition duration-300 group-hover/rail:opacity-100">
                              {isNameplatePreviewHovered &&
                              nameplateHoverPreviewUrl ? (
                                <UserNameplateLayer
                                  nameplateUrl={nameplateHoverPreviewUrl}
                                  nameplateContentType={
                                    nameplateHoverPreviewContentType
                                  }
                                  avatarDisplay={currentAvatarDisplay}
                                  seedId={currentUsername}
                                  alt="Nameplate preview"
                                  className="opacity-95"
                                />
                              ) : null}
                              <div className="absolute inset-0 bg-[linear-gradient(90deg,_rgba(10,12,16,0.82)_0%,_rgba(10,12,16,0.28)_38%,_rgba(10,12,16,0.18)_68%,_rgba(10,12,16,0.82)_100%)]" />
                              <div className="absolute inset-y-0 left-2 flex items-center gap-2">
                                <div className="h-6 w-6 overflow-hidden rounded-full border border-rm-border bg-rm-bg-surface/80">
                                  {currentAvatarSrc ? (
                                    <AvatarImage
                                      src={currentAvatarSrc}
                                      alt=""
                                      display={
                                        currentAvatarDisplayWithoutDecoration
                                      }
                                    />
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center text-[10px] font-bold text-white/80">
                                      {getDisplayInitial({
                                        name: currentDisplayName,
                                      })}
                                    </div>
                                  )}
                                </div>
                                <span className="max-w-[90px] truncate text-[11px] font-semibold text-white/88">
                                  {currentDisplayName}
                                </span>
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="flex h-full items-center justify-center text-[11px] text-rm-text-muted">
                            No nameplate selected
                          </div>
                        )}
                      </div>
                    </ProfileRailCard>
                  </ProfileRailSection>

                  <ProfileRailSection title="Avatar & Decoration">
                    <div className="grid grid-cols-2 gap-2.5">
                      <div ref={avatarMenuRef} className="relative">
                        <ProfileRailCard
                          className="flex h-[88px] overflow-visible items-center justify-center p-2.5"
                          actions={
                            <AccountActionIconButton
                              label="Crop avatar"
                              onClick={handleEditAvatarFrame}
                              disabled={!currentAvatarSrc}
                            >
                              <Crop size={12} />
                            </AccountActionIconButton>
                          }
                        >
                          <button
                            ref={avatarRailTriggerRef}
                            type="button"
                            onClick={() => {
                              setProfileMenuAnchor(null);
                              setAvatarMenuAnchor((anchor) =>
                                anchor === "rail" ? null : "rail",
                              );
                            }}
                            className="group/avatar relative flex h-[64px] w-[64px] items-center justify-center rounded-[16px] border border-rm-border bg-rm-bg-surface/70 outline-none transition-[transform,box-shadow] hover:scale-[1.03] hover:shadow-[0_12px_26px_rgba(0,0,0,0.25)] focus-visible:ring-2 focus-visible:ring-primary"
                            aria-label="Open avatar actions"
                            aria-haspopup="true"
                            aria-expanded={avatarMenuOpen}
                          >
                            <div className="relative h-[50px] w-[50px] overflow-hidden rounded-full border border-rm-border/80 bg-rm-bg-elevated shadow-[0_12px_24px_rgba(0,0,0,0.22)]">
                              {currentAvatarSrc ? (
                                <AvatarImage
                                  src={currentAvatarSrc}
                                  alt={currentDisplayName}
                                  display={
                                    currentAvatarDisplayWithoutDecoration
                                  }
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center bg-rm-bg-elevated text-xl font-bold text-rm-text">
                                  {getDisplayInitial({
                                    name: currentDisplayName,
                                  })}
                                </div>
                              )}
                            </div>
                          </button>

                          {avatarMenuAnchor === "rail" ? (
                            <ProfileActionMenu
                              restoreFocusRef={avatarRailTriggerRef}
                              onRequestClose={() => setAvatarMenuAnchor(null)}
                              actions={[
                                {
                                  label: "Change Avatar",
                                  onClick: () => {
                                    setAvatarMenuAnchor(null);
                                    setAvatarPickerOpen(true);
                                  },
                                },
                                {
                                  label: "Change Avatar Decoration",
                                  onClick: () => {
                                    setAvatarMenuAnchor(null);
                                    handleOpenCollectibles("avatar_decoration");
                                  },
                                },
                                ...(hasRemovableAvatar
                                  ? [
                                      {
                                        label: "Remove Avatar",
                                        destructive: true,
                                        onClick: () => {
                                          setAvatarMenuAnchor(null);
                                          handleRemoveAvatar();
                                        },
                                      },
                                    ]
                                  : []),
                                ...(currentAvatarDecoration
                                  ? [
                                      {
                                        label: "Remove Avatar Decoration",
                                        destructive: true,
                                        onClick: () => {
                                          setAvatarMenuAnchor(null);
                                          handleRemoveCollectible(
                                            "avatar_decoration",
                                          );
                                        },
                                      },
                                    ]
                                  : []),
                              ]}
                            />
                          ) : null}
                        </ProfileRailCard>
                      </div>

                      <ProfileRailCard
                        className="flex h-[88px] items-center justify-center p-2.5"
                        onHoverChange={setIsAvatarDecorationPreviewHovered}
                        actions={
                          <>
                            <AccountActionIconButton
                              label="Change decoration"
                              onClick={() =>
                                handleOpenCollectibles("avatar_decoration")
                              }
                            >
                              <Sparkles size={12} />
                            </AccountActionIconButton>
                            <AccountActionIconButton
                              label="Remove decoration"
                              onClick={() =>
                                handleRemoveCollectible("avatar_decoration")
                              }
                              disabled={!currentAvatarDecoration}
                              className="text-rose-300 hover:bg-rose-500/12 hover:text-rose-100"
                            >
                              <Trash2 size={12} />
                            </AccountActionIconButton>
                          </>
                        }
                      >
                        <div className="relative flex h-[64px] w-[64px] items-center justify-center overflow-hidden rounded-[16px] border border-rm-border bg-rm-bg-surface/70">
                          {currentAvatarDecoration ? (
                            <>
                              <div className="absolute inset-0 transition duration-300 group-hover/rail:opacity-0">
                                <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.08),_rgba(255,255,255,0)_56%)]" />
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <img
                                    src={
                                      avatarDecorationPreviewArtUrl ??
                                      currentAvatarDecoration.imageUrl
                                    }
                                    alt={currentAvatarDecoration.name}
                                    className="h-[56px] w-[56px] object-contain opacity-95 drop-shadow-[0_12px_22px_rgba(0,0,0,0.34)]"
                                    loading="lazy"
                                    decoding="async"
                                  />
                                </div>
                              </div>
                              <div className="absolute inset-0 opacity-0 transition duration-300 group-hover/rail:opacity-100">
                                <div className="absolute inset-0 flex items-center justify-center">
                                  <div className="relative h-[50px] w-[50px] overflow-visible rounded-full border border-rm-border bg-rm-bg-elevated/90 shadow-[0_12px_24px_rgba(0,0,0,0.3)]">
                                    {isAvatarDecorationPreviewHovered &&
                                    currentAvatarSrc ? (
                                      <AvatarImage
                                        src={currentAvatarSrc}
                                        alt=""
                                        display={currentAvatarDisplay}
                                      />
                                    ) : (
                                      <>
                                        <div className="flex h-full w-full items-center justify-center rounded-full bg-rm-bg-elevated text-xl font-bold text-white/80">
                                          {getDisplayInitial({
                                            name: currentDisplayName,
                                          })}
                                        </div>
                                        <img
                                          src={currentAvatarDecoration.imageUrl}
                                          alt=""
                                          className="pointer-events-none absolute left-1/2 top-1/2 h-[124%] w-[124%] max-w-none -translate-x-1/2 -translate-y-1/2 object-contain"
                                          loading="lazy"
                                          decoding="async"
                                        />
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </>
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-rm-text-muted">
                              None
                            </div>
                          )}
                        </div>
                      </ProfileRailCard>
                    </div>
                  </ProfileRailSection>

                  <ProfileRailSection title="Display Name Style">
                    <ProfileRailCard
                      className="p-2.5"
                      actions={
                        <AccountActionIconButton
                          label={
                            hasDisplayNameStyle
                              ? "Clear display name style"
                              : "Add display name style"
                          }
                          onClick={() => {
                            if (hasDisplayNameStyle) {
                              setDisplayNameStyle(null);
                              return;
                            }
                            setDisplayNameStyleEditorOpen(true);
                          }}
                        >
                          {hasDisplayNameStyle ? (
                            <Trash2 size={14} />
                          ) : (
                            <Plus size={14} />
                          )}
                        </AccountActionIconButton>
                      }
                    >
                      <button
                        type="button"
                        onClick={() => setDisplayNameStyleEditorOpen(true)}
                        className="flex h-[48px] w-full items-center justify-center rounded-[14px] border border-rm-border bg-rm-bg-surface/60 px-4 pr-11 text-center outline-none transition-transform duration-200 hover:scale-[1.03] hover:bg-rm-bg-elevated/80 focus-visible:border-primary/60 focus-visible:shadow-[0_0_0_1px_rgba(88,101,242,0.4),0_12px_26px_rgba(0,0,0,0.2)]"
                        aria-label={
                          hasDisplayNameStyle
                            ? "Edit display name style"
                            : "Add display name style"
                        }
                      >
                        <ProfileDisplayName
                          text={currentDisplayName}
                          displayNameStyle={displayNameStyle}
                          className="block max-w-full truncate text-[15px] font-semibold leading-none tracking-[-0.04em] md:text-[16px]"
                        />
                      </button>
                    </ProfileRailCard>
                  </ProfileRailSection>

                  <ProfileRailSection title="Theme & Banner">
                    <ProfileRailCard className="overflow-visible p-2.5">
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="relative aspect-square overflow-visible">
                          <div className="absolute inset-0 overflow-hidden rounded-[16px] border border-rm-border/80 bg-rm-bg-surface shadow-[0_16px_32px_rgba(0,0,0,0.28)]">
                            <div
                              className="absolute inset-0"
                              style={{
                                ...previewThemeStyle,
                                background:
                                  profileAccentColor || profileBackgroundColor
                                    ? "var(--rm-profile-custom-surface)"
                                    : "var(--rm-profile-banner-fallback)",
                              }}
                            />
                            <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.04)_38%,rgba(0,0,0,0.16)_100%)]" />
                          </div>

                          <ColorField
                            label="Profile background"
                            value={profileBackgroundColor}
                            onChange={(value) =>
                              setProfileBackgroundColor(
                                value ?? DEFAULT_PROFILE_THEME.background,
                              )
                            }
                            presets={PROFILE_COLOR_SWATCHES}
                            defaultColor={DEFAULT_PROFILE_THEME.background}
                            containerClassName="absolute inset-x-0 top-2 z-30 flex justify-center"
                            renderTrigger={({ open, toggleOpen, value }) => (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={toggleOpen}
                                    className={cn(
                                      "flex h-7 w-7 items-center justify-center rounded-[10px] border-2 border-white bg-white/92 p-[3px] shadow-[0_10px_20px_rgba(0,0,0,0.24)] transition hover:scale-[1.03]",
                                      open &&
                                        "shadow-[0_0_0_1px_rgba(255,255,255,0.38),0_12px_26px_rgba(0,0,0,0.28)]",
                                    )}
                                    aria-label="Choose profile background color"
                                    aria-expanded={open}
                                  >
                                    <span
                                      className="h-full w-full rounded-[8px] border border-black/10"
                                      style={getPickerSurfaceStyle({
                                        fill: value,
                                        showEmptyPattern: !value,
                                        patternSize: "12px 12px",
                                        patternPosition: "0 0, 6px 6px",
                                      })}
                                    />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="top"
                                  sideOffset={8}
                                  className={SETTINGS_TOOLTIP_CONTENT_CLASS}
                                >
                                  Theme background
                                </TooltipContent>
                              </Tooltip>
                            )}
                          />

                          <ColorField
                            label="Profile accent"
                            value={profileAccentColor}
                            onChange={(value) =>
                              setProfileAccentColor(
                                value ?? DEFAULT_PROFILE_THEME.accent,
                              )
                            }
                            presets={PROFILE_COLOR_SWATCHES}
                            defaultColor={DEFAULT_PROFILE_THEME.accent}
                            containerClassName="absolute inset-x-0 bottom-2 z-30 flex justify-center"
                            popoverSide="top"
                            renderTrigger={({ open, toggleOpen, value }) => (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    onClick={toggleOpen}
                                    className={cn(
                                      "flex h-7 w-7 items-center justify-center rounded-[10px] border-2 border-white bg-white/92 p-[3px] shadow-[0_10px_20px_rgba(0,0,0,0.24)] transition hover:scale-[1.03]",
                                      open &&
                                        "shadow-[0_0_0_1px_rgba(255,255,255,0.38),0_12px_26px_rgba(0,0,0,0.28)]",
                                    )}
                                    aria-label="Choose profile accent color"
                                    aria-expanded={open}
                                  >
                                    <span
                                      className="h-full w-full rounded-[8px] border border-black/10"
                                      style={getPickerSurfaceStyle({
                                        fill: value,
                                        showEmptyPattern: !value,
                                        patternSize: "12px 12px",
                                        patternPosition: "0 0, 6px 6px",
                                      })}
                                    />
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="top"
                                  sideOffset={8}
                                  className={SETTINGS_TOOLTIP_CONTENT_CLASS}
                                >
                                  Theme accent
                                </TooltipContent>
                              </Tooltip>
                            )}
                          />
                        </div>

                        <div className="group/theme-banner relative aspect-square overflow-visible">
                          <ColorField
                            label="Banner color"
                            value={profileBannerColor}
                            onChange={setProfileBannerColor}
                            presets={PROFILE_COLOR_SWATCHES}
                            defaultColor="#5865F2"
                            previewBackground="var(--rm-profile-custom-banner-fallback)"
                            containerClassName="h-full"
                            renderTrigger={({ open, toggleOpen }) => (
                              <button
                                type="button"
                                onClick={toggleOpen}
                                className="relative block h-full w-full overflow-hidden rounded-[16px] border border-rm-border/80 bg-rm-bg-surface shadow-[0_16px_32px_rgba(0,0,0,0.28)] transition hover:-translate-y-[1px]"
                                aria-label="Choose banner fallback color"
                                aria-expanded={open}
                                title={bannerStatus}
                              >
                                <div
                                  className="absolute inset-0"
                                  style={{
                                    ...previewThemeStyle,
                                    background:
                                      "var(--rm-profile-custom-banner-fallback)",
                                  }}
                                />
                                <ProfileAssetLayer
                                  url={currentBannerUrl}
                                  contentType={currentBannerContentType}
                                  alt="Banner preview"
                                  className="opacity-95"
                                />
                                <div
                                  className="absolute inset-0"
                                  style={{
                                    background:
                                      "var(--rm-profile-custom-banner-overlay)",
                                  }}
                                />
                                <div className="absolute inset-0 bg-black/0 transition group-hover/theme-banner:bg-black/10" />
                                <div className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-[10px] border border-white/16 bg-black/20 text-white/88 opacity-0 shadow-[0_10px_22px_rgba(0,0,0,0.24)] backdrop-blur-sm transition group-hover/theme-banner:opacity-100">
                                  <Pipette size={12} />
                                </div>
                              </button>
                            )}
                          />

                          <div className="absolute right-1.5 top-1.5 z-20 flex items-center gap-1 opacity-100 transition duration-200 md:opacity-0 md:group-hover/theme-banner:opacity-100">
                            <AccountActionIconButton
                              label="Upload banner"
                              onClick={() => bannerInputRef.current?.click()}
                            >
                              <Upload size={12} />
                            </AccountActionIconButton>
                            <AccountActionIconButton
                              label="Remove banner"
                              onClick={() => {
                                setRemoveBanner(true);
                                setBannerFile(null);
                                setBannerPreview(null);
                              }}
                              disabled={!currentBannerUrl && !bannerFile}
                              className="text-rose-300 hover:bg-rose-500/12 hover:text-rose-100"
                            >
                              <Trash2 size={12} />
                            </AccountActionIconButton>
                          </div>
                        </div>
                      </div>
                    </ProfileRailCard>
                  </ProfileRailSection>

                  <ProfileRailSection title="Profile Effect & Frame">
                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="relative">
                        <ProfileRailCard
                          className="p-2.5"
                          onHoverChange={setIsProfileEffectPreviewHovered}
                          actions={
                            <AccountActionIconButton
                              label="Remove profile effect"
                              onClick={() =>
                                handleRemoveCollectible("profile_effect")
                              }
                              disabled={!currentProfileEffect}
                              className="text-rose-300 hover:bg-rose-500/12 hover:text-rose-100"
                            >
                              <Trash2 size={12} />
                            </AccountActionIconButton>
                          }
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setAvatarMenuAnchor(null);
                              setProfileMenuAnchor(null);
                              handleOpenCollectibles("profile_effect");
                            }}
                            className="group/profile-effect relative block h-[88px] w-full cursor-pointer overflow-hidden rounded-[12px] border border-rm-border/70 bg-rm-bg-surface text-left outline-none transition-[border-color,box-shadow] hover:border-rm-border hover:shadow-[0_18px_32px_rgba(0,0,0,0.24)] focus-visible:border-primary/60 focus-visible:shadow-[0_0_0_1px_rgba(88,101,242,0.4),0_18px_32px_rgba(0,0,0,0.24)]"
                            aria-label="Browse profile effects"
                          >
                            <div className="absolute inset-0 flex items-center justify-center px-3">
                              <div
                                className="relative h-[74px] overflow-hidden rounded-[12px] border border-rm-border/70 bg-rm-bg-elevated shadow-[0_18px_34px_rgba(0,0,0,0.3)] transition-transform duration-200 group-hover/profile-effect:scale-[1.03]"
                                style={{ aspectRatio: "450 / 880" }}
                              >
                                <div
                                  className="absolute inset-0"
                                  style={{
                                    ...previewThemeStyle,
                                    backgroundColor:
                                      previewTheme.backgroundColor ?? undefined,
                                    backgroundImage:
                                      "var(--rm-profile-custom-surface)",
                                  }}
                                />
                                {currentProfileEffectDisplay ? (
                                  <ProfileCollectiblesLayer
                                    display={currentProfileEffectDisplay}
                                    effectOpacity={1}
                                    fit="contain"
                                    className="z-10 opacity-100"
                                    playAnimation={
                                      isProfileEffectPreviewHovered
                                    }
                                  />
                                ) : (
                                  <div className="absolute inset-0 z-10 flex items-center justify-center text-rm-text-muted">
                                    <Plus size={22} strokeWidth={2.5} />
                                  </div>
                                )}
                                <div className="absolute inset-0 bg-[linear-gradient(180deg,_rgba(255,255,255,0.12)_0%,_rgba(255,255,255,0.04)_42%,_rgba(0,0,0,0.16)_100%)]" />
                              </div>
                            </div>
                          </button>
                        </ProfileRailCard>
                      </div>

                      <div className="relative">
                        <ProfileRailCard
                          className="overflow-visible p-2.5"
                          actions={
                            <AccountActionIconButton
                              label="Remove profile frame"
                              onClick={() =>
                                handleRemoveCollectible("profile_frame")
                              }
                              disabled={!currentProfileFrame}
                              className="text-rose-300 hover:bg-rose-500/12 hover:text-rose-100"
                            >
                              <Trash2 size={12} />
                            </AccountActionIconButton>
                          }
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setAvatarMenuAnchor(null);
                              setProfileMenuAnchor(null);
                              handleOpenCollectibles("profile_frame");
                            }}
                            className="group/profile-frame relative block h-[88px] w-full cursor-pointer overflow-visible rounded-[12px] border border-rm-border/70 bg-rm-bg-surface text-left outline-none transition-[border-color,box-shadow] hover:border-rm-border hover:shadow-[0_18px_32px_rgba(0,0,0,0.24)] focus-visible:border-primary/60 focus-visible:shadow-[0_0_0_1px_rgba(88,101,242,0.4),0_18px_32px_rgba(0,0,0,0.24)]"
                            aria-label="Browse profile frames"
                          >
                            <div className="absolute inset-0 flex items-center justify-center px-3 overflow-visible">
                              <div
                                className="relative h-[74px] overflow-visible rounded-[12px] border border-rm-border/70 bg-rm-bg-elevated shadow-[0_18px_34px_rgba(0,0,0,0.3)] transition-transform duration-200 group-hover/profile-frame:scale-[1.03]"
                                style={{ aspectRatio: "450 / 880" }}
                              >
                                <div
                                  className="absolute inset-0 overflow-hidden rounded-[12px]"
                                  style={{
                                    ...previewThemeStyle,
                                    backgroundColor:
                                      previewTheme.backgroundColor ?? undefined,
                                    backgroundImage:
                                      "var(--rm-profile-custom-surface)",
                                  }}
                                />
                                {currentProfileFrameDisplay ? (
                                  <>
                                    <ProfileFrameLayer
                                      display={currentProfileFrameDisplay}
                                      order="back"
                                      className="z-0"
                                    />
                                    <ProfileFrameLayer
                                      display={currentProfileFrameDisplay}
                                      order="front"
                                      className="z-20"
                                    />
                                  </>
                                ) : (
                                  <div className="absolute inset-0 z-10 flex items-center justify-center text-rm-text-muted">
                                    <Plus size={22} strokeWidth={2.5} />
                                  </div>
                                )}
                                <div className="absolute inset-0 bg-[linear-gradient(180deg,_rgba(255,255,255,0.12)_0%,_rgba(255,255,255,0.04)_42%,_rgba(0,0,0,0.16)_100%)]" />
                              </div>
                            </div>
                          </button>
                        </ProfileRailCard>
                      </div>
                    </div>
                  </ProfileRailSection>
                </div>
              </div>
            </aside>

            <div
              className={cn(
                "relative z-0 min-w-0 overflow-visible bg-rm-bg-elevated md:grid md:justify-center md:gap-6 md:px-5 md:py-5 lg:gap-8 lg:px-8 lg:py-8",
                "md:grid-cols-[minmax(0,388px)_minmax(0,520px)] lg:grid-cols-[minmax(0,400px)_minmax(0,540px)]",
                "lg:h-full lg:min-h-0 lg:overflow-hidden",
                !asModal &&
                  "border border-[color:var(--rm-profile-custom-card-border)] shadow-[0_26px_80px_rgba(0,0,0,0.34)]",
                asModal && stylesCollapsed && "md:mx-auto md:max-w-[1080px]",
              )}
              style={{
                ...previewThemeStyle,
                backgroundImage: "var(--rm-profile-custom-surface)",
              }}
            >
              <ProfileSurfaceBackdrop
                bannerUrl={currentBannerUrl}
                bannerContentType={currentBannerContentType}
              />
              <div
                className="pointer-events-none absolute inset-0 z-[2]"
                style={{
                  background: "var(--rm-profile-custom-surface-overlay-strong)",
                }}
              />
              {asModal && stylesCollapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      ref={profileBannerTriggerRef}
                      type="button"
                      onClick={() => setStylesCollapsed(false)}
                      className="group absolute left-0 top-1/2 z-20 hidden -translate-x-[46%] -translate-y-1/2 rounded-r-2xl rounded-l-xl border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] px-3 py-3 text-[12px] font-semibold text-[color:var(--rm-profile-custom-text)] shadow-[0_18px_34px_rgba(0,0,0,0.28)] transition hover:-translate-x-[40%] lg:flex"
                      style={previewThemeStyle}
                      aria-label="Show styles"
                    >
                      <span className="rotate-180">
                        <ChevronsRight size={16} />
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="right"
                    sideOffset={10}
                    className={SETTINGS_TOOLTIP_CONTENT_CLASS}
                  >
                    Show styles
                  </TooltipContent>
                </Tooltip>
              ) : null}

              <div className="relative z-10 mx-auto mt-16 mb-14 w-full max-w-[400px] self-start overflow-visible lg:mt-10 lg:mb-0 lg:h-[min(782px,calc(100dvh-108px))]">
                <ProfileSurfaceShell
                  display={currentAvatarDisplay}
                  className="relative h-auto w-full max-w-[400px] lg:h-full lg:aspect-[450/880] lg:w-[min(400px,calc(51.136dvh_-_55.2px))]"
                  surfaceStyle={{ aspectRatio: PROFILE_SURFACE_ASPECT_RATIO }}
                >
                  <div
                    ref={profilePreviewMenuRef}
                    className="relative h-[18%] min-h-[128px]"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setAvatarMenuAnchor(null);
                        setProfileMenuAnchor((anchor) =>
                          anchor === "preview" ? null : "preview",
                        );
                      }}
                      className="group/preview-banner relative block h-full min-h-[128px] w-full overflow-hidden text-left"
                      style={{
                        background: "var(--rm-profile-custom-banner-fallback)",
                      }}
                      aria-label="Open profile effect and frame actions"
                      aria-haspopup="true"
                      aria-expanded={profileMenuAnchor === "preview"}
                    >
                      <ProfileAssetLayer
                        url={currentBannerUrl}
                        contentType={currentBannerContentType}
                        alt="Profile banner"
                        className="opacity-94"
                      />
                      <div
                        className="absolute inset-0"
                        style={{
                          background: "var(--rm-profile-custom-banner-overlay)",
                        }}
                      />
                      <div className="absolute inset-0 bg-black/0 transition group-hover/preview-banner:bg-black/28" />
                      <span
                        ref={profileBannerActionRef}
                        className="absolute right-4 top-4 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] text-[color:var(--rm-profile-custom-text)] opacity-0 shadow-[0_14px_28px_rgba(0,0,0,0.24)] backdrop-blur-sm transition group-hover/preview-banner:opacity-100"
                      >
                        <Pencil size={15} />
                      </span>
                    </button>
                    {profileMenuAnchor === "preview" ? (
                      <ProfileActionMenu
                        anchorRef={profileBannerActionRef}
                        restoreFocusRef={profileBannerTriggerRef}
                        placement="right"
                        portal
                        onRequestClose={() => setProfileMenuAnchor(null)}
                        actions={[
                          {
                            label: "Change Banner",
                            onClick: () => {
                              setProfileMenuAnchor(null);
                              setBannerPickerOpen(true);
                            },
                          },
                          {
                            label: "Change Profile Effect",
                            onClick: () => {
                              setProfileMenuAnchor(null);
                              handleOpenCollectibles("profile_effect");
                            },
                          },
                          {
                            label: "Change Profile Frame",
                            onClick: () => {
                              setProfileMenuAnchor(null);
                              handleOpenCollectibles("profile_frame");
                            },
                          },
                          ...(currentProfileEffect
                            ? [
                                {
                                  label: "Remove Profile Effect",
                                  destructive: true,
                                  onClick: () => {
                                    setProfileMenuAnchor(null);
                                    handleRemoveCollectible("profile_effect");
                                  },
                                },
                              ]
                            : []),
                          ...(currentProfileFrame
                            ? [
                                {
                                  label: "Remove Profile Frame",
                                  destructive: true,
                                  onClick: () => {
                                    setProfileMenuAnchor(null);
                                    handleRemoveCollectible("profile_frame");
                                  },
                                },
                              ]
                            : []),
                        ]}
                      />
                    ) : null}
                  </div>

                  <div className="relative z-20 px-6 pb-7">
                    <div className="-mt-9">
                      <div className="flex items-start justify-between gap-4">
                        <div
                          ref={avatarPreviewMenuRef}
                          className="relative shrink-0"
                        >
                          <button
                            ref={avatarPreviewTriggerRef}
                            type="button"
                            onClick={() => {
                              setProfileMenuAnchor(null);
                              setAvatarMenuAnchor((anchor) =>
                                anchor === "preview" ? null : "preview",
                              );
                            }}
                            className="group/preview-avatar relative h-28 w-28 rounded-full border-[6px] border-rm-bg-elevated bg-[var(--rm-profile-custom-card-bg-strong)] shadow-[0_18px_46px_rgba(0,0,0,0.42)] transition-[transform,box-shadow] hover:scale-[1.02] hover:shadow-[0_20px_52px_rgba(0,0,0,0.48)] focus-visible:ring-2 focus-visible:ring-primary"
                            aria-label="Open avatar actions"
                            aria-haspopup="true"
                            aria-expanded={avatarMenuOpen}
                          >
                            {currentAvatarSrc ? (
                              <AvatarImage
                                src={currentAvatarSrc}
                                alt={currentDisplayName}
                                display={currentAvatarDisplay}
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center rounded-full text-3xl font-bold text-[color:var(--rm-profile-custom-text)]">
                                {getDisplayInitial({
                                  name: currentDisplayName,
                                })}
                              </div>
                            )}
                            <span className="absolute inset-0 rounded-full bg-black/0 transition group-hover/preview-avatar:bg-black/36" />
                            <span className="absolute inset-0 z-10 flex items-center justify-center opacity-0 transition group-hover/preview-avatar:opacity-100">
                              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] text-[color:var(--rm-profile-custom-text)] shadow-[0_14px_28px_rgba(0,0,0,0.24)] backdrop-blur-sm">
                                <Pencil size={16} />
                              </span>
                            </span>
                          </button>
                          {avatarMenuAnchor === "preview" ? (
                            <ProfileActionMenu
                              restoreFocusRef={avatarPreviewTriggerRef}
                              onRequestClose={() => setAvatarMenuAnchor(null)}
                              actions={[
                                {
                                  label: "Change Avatar",
                                  onClick: () => {
                                    setAvatarMenuAnchor(null);
                                    setAvatarPickerOpen(true);
                                  },
                                },
                                {
                                  label: "Change Avatar Decoration",
                                  onClick: () => {
                                    setAvatarMenuAnchor(null);
                                    handleOpenCollectibles("avatar_decoration");
                                  },
                                },
                                ...(hasRemovableAvatar
                                  ? [
                                      {
                                        label: "Remove Avatar",
                                        destructive: true,
                                        onClick: () => {
                                          setAvatarMenuAnchor(null);
                                          handleRemoveAvatar();
                                        },
                                      },
                                    ]
                                  : []),
                                ...(currentAvatarDecoration
                                  ? [
                                      {
                                        label: "Remove Avatar Decoration",
                                        destructive: true,
                                        onClick: () => {
                                          setAvatarMenuAnchor(null);
                                          handleRemoveCollectible(
                                            "avatar_decoration",
                                          );
                                        },
                                      },
                                    ]
                                  : []),
                              ]}
                            />
                          ) : null}
                        </div>

                        <div className="relative ml-auto flex w-full min-w-0 max-w-[220px] justify-end pt-10">
                          {isCustomStatusEditing ? (
                            <div className="relative z-50 flex h-[42px] w-full min-w-0 items-center rounded-full border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] p-1 shadow-[0_18px_40px_rgba(0,0,0,0.28)] backdrop-blur-xl animate-in fade-in zoom-in-95">
                              <input
                                ref={previewCustomStatusInputRef}
                                type="text"
                                value={customStatusDraft}
                                onChange={(event) =>
                                  setCustomStatusDraft(
                                    event.target.value.slice(0, 128),
                                  )
                                }
                                onClick={(event) => event.stopPropagation()}
                                onBlur={handleSaveCustomStatus}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    handleSaveCustomStatus();
                                  }

                                  if (event.key === "Escape") {
                                    event.preventDefault();
                                    setCustomStatusDraft(
                                      chatUser?.custom_status ?? "",
                                    );
                                    setIsCustomStatusEditing(false);
                                  }
                                }}
                                className="min-w-0 flex-1 rounded-full bg-white/10 px-3 py-2 text-[13px] text-[color:var(--rm-profile-custom-text)] outline-none placeholder:text-[color:var(--rm-profile-custom-muted)]"
                                aria-label="Custom status"
                                placeholder="Support custom status!"
                                maxLength={128}
                              />
                            </div>
                          ) : hasCustomStatus ? (
                            <div className="group/preview-status inline-flex max-w-full min-w-0 items-center gap-2 rounded-full border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] pl-3 pr-2 py-1.5 text-left shadow-[0_12px_28px_rgba(0,0,0,0.22)] backdrop-blur-md transition-colors hover:bg-[var(--rm-profile-custom-card-bg)]">
                              <button
                                type="button"
                                className="min-w-0 flex-1 rounded-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                                aria-label="Edit custom status"
                                onClick={handleOpenCustomStatusEditor}
                              >
                                <span className="block min-w-0 truncate text-[13px] italic font-medium text-[color:var(--rm-profile-custom-text)]">
                                  {visibleCustomStatus}
                                </span>
                              </button>
                              <span className="flex shrink-0 items-center gap-1 pl-1">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleOpenCustomStatusEditor();
                                      }}
                                      className="pointer-events-none flex h-7 w-7 items-center justify-center rounded-full border border-transparent text-[color:var(--rm-profile-custom-muted)] opacity-0 transition hover:border-[color:var(--rm-profile-custom-card-border)] hover:bg-[var(--rm-profile-custom-card-bg-strong)] hover:text-[color:var(--rm-profile-custom-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 group-hover/preview-status:pointer-events-auto group-hover/preview-status:opacity-100 group-focus-within/preview-status:pointer-events-auto group-focus-within/preview-status:opacity-100"
                                      aria-label="Edit custom status"
                                    >
                                      <Pencil size={14} />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent
                                    side="top"
                                    sideOffset={8}
                                    className={SETTINGS_TOOLTIP_CONTENT_CLASS}
                                  >
                                    Edit custom status
                                  </TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleClearCustomStatus();
                                      }}
                                      className="pointer-events-none flex h-7 w-7 items-center justify-center rounded-full border border-transparent text-[color:var(--rm-profile-custom-muted)] opacity-0 transition hover:border-[color:var(--rm-profile-custom-card-border)] hover:bg-[var(--rm-profile-custom-card-bg-strong)] hover:text-[color:var(--rm-profile-custom-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 group-hover/preview-status:pointer-events-auto group-hover/preview-status:opacity-100 group-focus-within/preview-status:pointer-events-auto group-focus-within/preview-status:opacity-100"
                                      aria-label="Clear custom status"
                                    >
                                      <Trash2 size={14} />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent
                                    side="top"
                                    sideOffset={8}
                                    className={SETTINGS_TOOLTIP_CONTENT_CLASS}
                                  >
                                    Clear custom status
                                  </TooltipContent>
                                </Tooltip>
                              </span>
                            </div>
                          ) : (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] px-3 py-1.5 text-left shadow-[0_12px_28px_rgba(0,0,0,0.22)] backdrop-blur-md transition-colors hover:bg-[var(--rm-profile-custom-card-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                                  aria-label="Add custom status"
                                  onClick={handleOpenCustomStatusEditor}
                                >
                                  <Plus
                                    size={14}
                                    className="shrink-0 text-[color:var(--rm-profile-custom-muted)]"
                                  />
                                  <span className="min-w-0 truncate text-[13px] italic font-medium text-[color:var(--rm-profile-custom-text)]">
                                    Today I learned...
                                  </span>
                                </button>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                sideOffset={8}
                                className={SETTINGS_TOOLTIP_CONTENT_CLASS}
                              >
                                Add custom status
                              </TooltipContent>
                            </Tooltip>
                          )}

                          {SHOW_LEGACY_PREVIEW_IDENTITY ? (
                            <>
                              {chatUser?.custom_status ? (
                                <div className="mb-3 inline-flex max-w-[180px] items-center rounded-full border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] px-3.5 py-2 text-[12px] font-medium text-[color:var(--rm-profile-custom-text)] shadow-[0_14px_28px_rgba(0,0,0,0.22)] backdrop-blur-sm">
                                  <span className="truncate">
                                    {chatUser.custom_status}
                                  </span>
                                </div>
                              ) : null}
                              <ProfileDisplayName
                                text={currentDisplayName}
                                displayNameStyle={displayNameStyle}
                                className="truncate text-[20px] font-semibold tracking-[-0.03em] text-[color:var(--rm-profile-custom-text)]"
                                backgroundColor={previewTheme.backgroundColor}
                                readableFallbackColor={previewTheme.textColor}
                              />
                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[color:var(--rm-profile-custom-muted)]">
                                <span>@{currentUsername}</span>
                                <span
                                  aria-hidden="true"
                                  className="text-[color:var(--rm-profile-custom-muted)]/60"
                                >
                                  •
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setActivePreviewField("pronouns")
                                  }
                                  className="group/preview-pronouns rounded-md px-1.5 py-0.5 -mx-1.5 text-left transition hover:bg-[var(--rm-profile-custom-card-bg-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                                >
                                  {activePreviewField === "pronouns" ? (
                                    <input
                                      ref={previewPronounsInputRef}
                                      value={pronouns}
                                      onChange={(event) =>
                                        setPronouns(
                                          event.target.value.slice(0, 40),
                                        )
                                      }
                                      onBlur={() =>
                                        setActivePreviewField((current) =>
                                          current === "pronouns"
                                            ? null
                                            : current,
                                        )
                                      }
                                      onKeyDown={(event) => {
                                        if (
                                          event.key === "Enter" ||
                                          event.key === "Escape"
                                        ) {
                                          event.preventDefault();
                                          event.currentTarget.blur();
                                        }
                                      }}
                                      className="min-w-[88px] bg-transparent text-[13px] font-medium text-[color:var(--rm-profile-custom-text)] outline-none placeholder:text-[color:var(--rm-profile-custom-muted)]"
                                      placeholder="Add pronouns"
                                    />
                                  ) : (
                                    <span className="rounded-md border border-transparent px-1 py-0.5 text-[13px] font-medium text-[color:var(--rm-profile-custom-text)] transition group-hover/preview-pronouns:border-[color:var(--rm-profile-custom-card-border)] group-hover/preview-pronouns:bg-[var(--rm-profile-custom-card-bg-strong)]">
                                      {currentPronouns || "Add pronouns"}
                                    </span>
                                  )}
                                </button>
                              </div>
                            </>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-4">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="group/preview-display-name relative -mx-3 inline-flex max-w-full items-center rounded-[18px] border border-transparent px-3 py-2 pr-12 text-left transition hover:border-[color:var(--rm-profile-custom-card-border)] hover:bg-[var(--rm-profile-custom-card-bg-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                              aria-label={
                                hasDisplayNameStyle
                                  ? "Edit display name style"
                                  : "Add display name style"
                              }
                              onClick={() =>
                                setDisplayNameStyleEditorOpen(true)
                              }
                            >
                              <span className="pointer-events-none absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] text-[color:var(--rm-profile-custom-text)] opacity-0 shadow-[0_12px_24px_rgba(0,0,0,0.2)] transition group-hover/preview-display-name:opacity-100 group-focus-within/preview-display-name:opacity-100">
                                <Paintbrush size={14} />
                              </span>
                              <ProfileDisplayName
                                text={currentDisplayName}
                                displayNameStyle={displayNameStyle}
                                className="truncate text-[20px] font-semibold tracking-[-0.03em] text-[color:var(--rm-profile-custom-text)]"
                                backgroundColor={previewTheme.backgroundColor}
                                readableFallbackColor={previewTheme.textColor}
                              />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent
                            side="top"
                            sideOffset={8}
                            className={SETTINGS_TOOLTIP_CONTENT_CLASS}
                          >
                            {hasDisplayNameStyle
                              ? "Edit display name style"
                              : "Add display name style"}
                          </TooltipContent>
                        </Tooltip>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[color:var(--rm-profile-custom-muted)]">
                          <span>@{currentUsername}</span>
                          <span
                            aria-hidden="true"
                            className="text-[color:var(--rm-profile-custom-muted)]/60"
                          >
                            •
                          </span>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setActivePreviewField("pronouns");
                            }}
                            className="group/preview-pronouns -mx-1.5 rounded-md px-1.5 py-0.5 text-left transition hover:bg-[var(--rm-profile-custom-card-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                          >
                            {activePreviewField === "pronouns" ? (
                              <input
                                ref={previewPronounsInputRef}
                                value={pronouns}
                                onClick={(event) => event.stopPropagation()}
                                onChange={(event) =>
                                  setPronouns(event.target.value.slice(0, 40))
                                }
                                onBlur={() =>
                                  setActivePreviewField((current) =>
                                    current === "pronouns" ? null : current,
                                  )
                                }
                                onKeyDown={(event) => {
                                  if (
                                    event.key === "Enter" ||
                                    event.key === "Escape"
                                  ) {
                                    event.preventDefault();
                                    event.currentTarget.blur();
                                  }
                                }}
                                className="min-w-[88px] bg-transparent text-[13px] font-medium text-[color:var(--rm-profile-custom-text)] outline-none placeholder:text-[color:var(--rm-profile-custom-muted)]"
                                placeholder="Add pronouns"
                              />
                            ) : (
                              <span className="rounded-md border border-transparent px-1 py-0.5 text-[13px] font-medium text-[color:var(--rm-profile-custom-text)] transition group-hover/preview-pronouns:border-[color:var(--rm-profile-custom-card-border)] group-hover/preview-pronouns:bg-[var(--rm-profile-custom-card-bg)]">
                                {currentPronouns || "Add pronouns"}
                              </span>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 flex items-center gap-2">
                      <Button
                        type="button"
                        className="h-10 rounded-xl bg-[var(--rm-profile-custom-button-bg)] px-4 text-[color:var(--rm-profile-custom-button-text)] shadow-[0_14px_28px_var(--rm-profile-custom-button-shadow)] hover:opacity-95"
                      >
                        Message
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="icon"
                        className="h-9 w-9 rounded-xl border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] text-[color:var(--rm-profile-custom-muted)] shadow-[0_12px_24px_rgba(0,0,0,0.22)] hover:bg-[var(--rm-profile-custom-card-bg)] hover:text-[color:var(--rm-profile-custom-text)]"
                        aria-label="Open profile shop"
                      >
                        <ShoppingBag size={16} />
                      </Button>
                    </div>

                    <div className="mt-2 space-y-4">
                      <button
                        type="button"
                        onClick={() => setActivePreviewField("bio")}
                        className="group/preview-bio block w-full rounded-[18px] border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] px-4 py-3 text-left transition hover:border-[color:var(--rm-profile-custom-text)]/22 hover:bg-[var(--rm-profile-custom-card-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35"
                      >
                        {activePreviewField === "bio" ? (
                          <div>
                            <textarea
                              ref={previewBioInputRef}
                              value={bio}
                              onChange={(event) =>
                                setBio(event.target.value.slice(0, 190))
                              }
                              onBlur={() =>
                                setActivePreviewField((current) =>
                                  current === "bio" ? null : current,
                                )
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  event.currentTarget.blur();
                                }
                              }}
                              className="min-h-[74px] w-full resize-none bg-transparent text-[14px] leading-6 text-[color:var(--rm-profile-custom-text)] outline-none placeholder:text-[color:var(--rm-profile-custom-muted)]"
                              placeholder="Add a bio here"
                            />
                            <div className="mt-2 text-right text-[11px] text-[color:var(--rm-profile-custom-muted)]">
                              {bio.trim().length}/190
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--rm-profile-custom-muted)]">
                              Bio
                            </div>
                            <div className="rounded-[14px] border border-transparent px-0 py-0.5 text-[14px] leading-6 text-[color:var(--rm-profile-custom-text)] transition group-hover/preview-bio:border-[color:var(--rm-profile-custom-card-border)]">
                              {currentBio || (
                                <span className="text-[color:var(--rm-profile-custom-muted)]">
                                  Add a bio here
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </button>

                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--rm-profile-custom-muted)]">
                          {previewReferenceDate.label}
                        </div>
                        <div className="mt-2 text-[14px] text-[color:var(--rm-profile-custom-text)]">
                          {previewReferenceDate.value}
                        </div>
                      </div>
                    </div>
                  </div>
                </ProfileSurfaceShell>
              </div>

              <aside
                className={cn(
                  "relative z-10 w-full max-w-[540px] self-start justify-self-center",
                  asModal && "min-h-0 md:flex md:h-full md:flex-col",
                )}
              >
                <div
                  className="flex items-center gap-5 border-b border-[color:var(--rm-profile-custom-card-border)] pb-3"
                  style={previewThemeStyle}
                >
                  {["Board", "Activity", "Wishlist"].map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      className={cn(
                        "pb-2 text-[13px] font-semibold text-[color:var(--rm-profile-custom-muted)] transition",
                        tab === "Board" &&
                          "border-b-2 border-[color:var(--rm-profile-custom-text)] text-[color:var(--rm-profile-custom-text)]",
                      )}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <div
                    className="text-[13px] font-medium text-[color:var(--rm-profile-custom-muted)]"
                    style={previewThemeStyle}
                  >
                    Your Widgets
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-xl border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] px-3 py-2 text-[14px] font-semibold text-[color:var(--rm-profile-custom-text)] transition hover:bg-[var(--rm-profile-custom-card-bg)]"
                    style={previewThemeStyle}
                  >
                    <Plus size={15} />
                    Add Widget
                  </button>
                </div>

                <div
                  className={cn(
                    "mt-4 space-y-4",
                    asModal &&
                      "md:min-h-0 md:flex-1 md:overflow-y-auto md:pr-1",
                  )}
                >
                  <ProfilePreviewWidgetCard
                    title="Favorite game"
                    subtitle="Choose 1 game"
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-[84px] w-[84px] shrink-0 overflow-hidden rounded-[18px] border border-white/8 bg-[linear-gradient(135deg,_#d8dde7,_#64748b_70%,_#1f2937)]" />
                      <div className="min-w-0">
                        <div className="truncate text-[16px] font-semibold text-[color:var(--rm-profile-custom-text)]">
                          Your featured title goes here
                        </div>
                        <div className="mt-2 text-[13px] italic text-[color:var(--rm-profile-custom-muted)]">
                          Let everyone know why this is your favorite.
                        </div>
                        <div className="mt-3 inline-flex rounded-full border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg)] px-2 py-1 text-[11px] text-[color:var(--rm-profile-custom-muted)]">
                          + Tags
                        </div>
                      </div>
                    </div>
                  </ProfilePreviewWidgetCard>

                  <ProfilePreviewWidgetCard
                    title="Games in rotation"
                    subtitle="Add up to 5 games"
                  >
                    <div className="space-y-3">
                      {[1, 2].map((item) => (
                        <div
                          key={item}
                          className="flex items-center gap-3 rounded-[18px] border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg)] p-3"
                        >
                          <div className="h-[54px] w-[54px] shrink-0 overflow-hidden rounded-[14px] bg-[linear-gradient(135deg,_#f2c94c,_#f97316_72%,_#7c2d12)]" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-[14px] font-semibold text-[color:var(--rm-profile-custom-text)]">
                              Rotating game slot {item}
                            </div>
                            <div className="mt-1 text-[12px] text-[color:var(--rm-profile-custom-muted)]">
                              Add art, tags, and quick notes here.
                            </div>
                          </div>
                          <button
                            type="button"
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[color:var(--rm-profile-custom-card-border)] bg-[var(--rm-profile-custom-card-bg-strong)] text-[color:var(--rm-profile-custom-muted)] transition hover:bg-[var(--rm-profile-custom-card-bg)] hover:text-[color:var(--rm-profile-custom-text)]"
                            aria-label={`Remove rotating game slot ${item}`}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </ProfilePreviewWidgetCard>
                  {error ? (
                    <div className="flex items-center gap-2 rounded-[20px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive shadow-[0_16px_32px_rgba(0,0,0,0.18)]">
                      <AlertTriangle size={14} />
                      <span>{error}</span>
                    </div>
                  ) : null}
                </div>
              </aside>
            </div>
          </div>

          {!asModal &&
          (claimLoading || claimCandidates.length > 0 || claimError) ? (
            <section className="mt-6 rounded-[32px] border border-amber-500/25 bg-amber-500/10 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.20)]">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-300">
                  {claimLoading ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <UserRoundCheck size={18} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold text-rm-text">
                    Claim Existing Ralph Meet Account
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-rm-text-secondary">
                    Pull your servers, messages, DMs, and profile history into
                    this Ralph Auth login.
                  </p>
                  {claimError ? (
                    <div className="mt-3 flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      <AlertTriangle size={14} />
                      {claimError}
                    </div>
                  ) : null}
                  {claimCandidates.length > 0 ? (
                    <div className="mt-4 space-y-2">
                      {claimCandidates.map((candidate) => (
                        <div
                          key={candidate.id}
                          className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-black/18 p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="relative h-10 w-10 shrink-0 rounded-full bg-white/6">
                              {candidate.avatar_url ? (
                                <AvatarImage
                                  src={candidate.avatar_url}
                                  alt=""
                                  display={candidate.avatar_display}
                                />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-sm font-bold text-rm-text-muted">
                                  {getDisplayInitial(candidate)}
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-rm-text">
                                {candidate.display_name || candidate.username}
                              </p>
                              <p className="truncate text-xs text-rm-text-muted">
                                @{candidate.username}
                              </p>
                            </div>
                          </div>
                          <Button
                            onClick={() => handleClaimAccount(candidate.id)}
                            disabled={claimingId !== null}
                            className="bg-amber-500 text-black hover:bg-amber-400"
                          >
                            {claimingId === candidate.id ? (
                              <Loader2 size={16} className="animate-spin" />
                            ) : (
                              "Claim"
                            )}
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {!asModal && hasChanges ? (
            <div className="mt-6 flex flex-col gap-3 rounded-[24px] border border-rm-border bg-rm-bg-elevated/92 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.24)] sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-rm-text">
                  Don&apos;t forget to save your changes.
                </p>
                <p className="mt-1 text-xs text-rm-text-muted">
                  Reset this draft or save it when you&apos;re ready.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={resetDraftState}
                  disabled={saving}
                  className="h-10 rounded-xl border border-rm-border bg-rm-bg-surface/80 px-4 text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
                >
                  Reset
                </Button>
                <Button
                  onClick={handleSaveProfile}
                  disabled={saving}
                  className="h-10 rounded-xl bg-primary px-4 text-primary-foreground hover:bg-primary/90"
                >
                  {saving ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    "Save Changes"
                  )}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {asModal && hasChanges ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[120] flex justify-center px-4 md:bottom-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="pointer-events-auto flex w-full max-w-[520px] flex-col gap-3 rounded-[24px] border border-rm-border bg-rm-bg-elevated/94 px-4 py-4 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-rm-text">
                Don&apos;t forget to save your changes.
              </p>
              <p className="mt-1 text-xs text-rm-text-muted">
                Reset this draft or save it when you&apos;re ready.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={resetDraftState}
                disabled={saving}
                className="h-10 rounded-xl border border-rm-border bg-rm-bg-surface/80 px-4 text-rm-text-muted hover:bg-rm-bg-hover hover:text-rm-text"
              >
                Reset
              </Button>
              <Button
                onClick={handleSaveProfile}
                disabled={saving}
                className="h-10 rounded-xl bg-primary px-4 text-primary-foreground hover:bg-primary/90"
              >
                {saving ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  "Save Changes"
                )}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {avatarPickerOpen ? (
        <AvatarPickerModal
          displayName={currentDisplayName}
          currentAvatarUrl={
            removeAvatar ? null : (selectedAvatarUrl ?? chatUser?.avatar_url)
          }
          onClose={() => setAvatarPickerOpen(false)}
          onUpload={handleAvatarFile}
          onSelectRecent={handleRecentAvatarSelect}
        />
      ) : null}
      {bannerPickerOpen ? (
        <AvatarPickerModal
          displayName={currentDisplayName}
          onClose={() => setBannerPickerOpen(false)}
          onUpload={handleBannerFile}
          showRecent={false}
          title="Select a Banner"
          description="Choose a new banner image or GIF for your profile."
          closeLabel="Close banner picker"
        />
      ) : null}
      {avatarEditor && (
        <AvatarFrameEditor
          image={avatarEditor}
          initialDisplay={currentAvatarDisplay}
          displayName={
            chatUser?.display_name ||
            chatUser?.username ||
            user.username ||
            "Profile"
          }
          onCancel={handleAvatarFrameCancel}
          onConfirm={handleAvatarFrameConfirm}
        />
      )}
      <DisplayNameStyleDialog
        key={
          displayNameStyleEditorOpen
            ? JSON.stringify(displayNameStyle)
            : "display-name-style-closed"
        }
        open={displayNameStyleEditorOpen}
        displayName={currentDisplayName}
        username={currentUsername}
        initialStyle={displayNameStyle}
        profileThemeStyle={previewThemeStyle}
        avatarSrc={currentAvatarSrc}
        avatarDisplay={currentAvatarDisplay}
        bannerUrl={currentBannerUrl}
        bannerContentType={currentBannerContentType}
        nameplateUrl={currentNameplateUrl}
        nameplateContentType={currentNameplateContentType}
        profileThemeBackgroundColor={previewTheme.backgroundColor}
        profileThemeTextColor={previewTheme.textColor}
        onClose={() => setDisplayNameStyleEditorOpen(false)}
        onApply={setDisplayNameStyle}
      />
      {collectiblesKind && (
        <CollectiblesCatalogModal
          initialKind={collectiblesKind}
          currentDisplay={currentAvatarDisplay}
          avatarSrc={currentAvatarSrc}
          displayName={currentDisplayName}
          onClose={() => setCollectiblesKind(null)}
          onApplied={async (updatedUser, appliedKinds) => {
            await syncCollectibleState(updatedUser, appliedKinds);
          }}
        />
      )}
    </div>
  );
}
