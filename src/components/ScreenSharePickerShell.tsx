/**
 * One screen-share picker shell for the desktop app and the web.
 *
 *   header   title + description, close x (dialog), 24px inset
 *   tabs     optional (desktop: Applications / Entire screen / Devices)
 *   source   the scrolling middle: the desktop source grid, or on the web a
 *            single "Choose what to share" row that hands off to the browser
 *   footer   quality segmented control + "Include audio" switch, then the
 *            selected-source summary with Cancel and Go live
 *
 * A centred dialog on desktop widths, a bottom drawer on phones. Everything
 * sizes from its container, so it reads the same in a 860px dialog and a
 * 360px window.
 */

import type { ComponentProps, ReactNode } from "react";
import { useId } from "react";

import { StreamQualityControl } from "@/components/StreamQualityControl";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { Switch } from "@/components/ui/switch";
import { SCREEN_SHARE_QUALITY_PRESETS } from "@/lib/screen-share-support";
import { cn } from "@/lib/utils";

type ContentProps = Omit<
  ComponentProps<typeof ResponsiveDialogContent>,
  "children" | "className"
>;

export interface ScreenSharePickerShellProps {
  open: boolean;
  onClose: () => void;
  description: ReactNode;
  /** The tab bar (desktop app), rendered between the header and the source area. */
  tabs?: ReactNode;
  /** The scrolling source area. */
  children: ReactNode;
  footer: ReactNode;
  /**
   * `picker`: a fixed-height dialog (a full-height sheet on phones) whose
   * source list scrolls between the tabs and the footer. `compact`: as tall
   * as its content.
   */
  size?: "picker" | "compact";
  contentProps?: ContentProps;
  /** Attributes for the source area (the tab panel's role, id and label). */
  sourceProps?: Omit<ComponentProps<"div">, "className" | "children">;
}

const SIZE_CLASSES = {
  picker: {
    dialog:
      "flex h-[min(640px,calc(100dvh-32px))] flex-col overflow-hidden md:max-w-[min(860px,calc(100%-2rem))]",
    drawer: "h-[calc(100dvh-24px)] px-0 pt-1 pb-0",
  },
  compact: {
    dialog:
      "flex max-h-[calc(100dvh-32px)] flex-col overflow-hidden md:max-w-lg",
    drawer: "max-h-[calc(100dvh-24px)] px-0 pt-1 pb-0",
  },
} as const;

export function ScreenSharePickerShell({
  open,
  onClose,
  description,
  tabs,
  children,
  footer,
  size = "picker",
  contentProps,
  sourceProps,
}: ScreenSharePickerShellProps) {
  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <ResponsiveDialogContent
        {...contentProps}
        className="gap-0 p-0"
        dialogClassName={SIZE_CLASSES[size].dialog}
        drawerClassName={SIZE_CLASSES[size].drawer}
      >
        <ResponsiveDialogHeader className="shrink-0 px-4 pt-2 pb-3 pr-12 md:px-6 md:pt-5">
          <ResponsiveDialogTitle>Share your screen</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {description}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        {tabs}
        <div
          {...sourceProps}
          className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 md:px-6"
        >
          {children}
        </div>
        {footer}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

export interface ScreenSharePickerFooterProps {
  /** Selected preset id, such as "1080p60". */
  quality: string;
  onQualityChange: (id: string) => void;
  availableQualities: readonly string[];
  withAudio: boolean;
  onWithAudioChange: (next: boolean) => void;
  /** Extra line under "Include audio" (the web explains what each source shares). */
  audioDescription?: string;
  /** The picked source, shown beside the buttons. Omit on the web. */
  sourceName?: string;
  /** False while `sourceName` is a prompt ("Select a source"), not a name. */
  sourcePicked?: boolean;
  onClose: () => void;
  onStart: () => void;
  /** "Go live" is disabled until a source is picked. */
  startDisabled?: boolean;
}

export function ScreenSharePickerFooter({
  quality,
  onQualityChange,
  availableQualities,
  withAudio,
  onWithAudioChange,
  audioDescription,
  sourceName,
  sourcePicked = true,
  onClose,
  onStart,
  startDisabled = false,
}: ScreenSharePickerFooterProps) {
  const audioId = useId();
  const audioDescId = useId();
  const presets = SCREEN_SHARE_QUALITY_PRESETS.filter((p) =>
    availableQualities.includes(p.id),
  );
  const selected = presets.find((p) => p.id === quality) ?? presets[0];

  return (
    <div
      data-slot="screen-share-footer"
      className="@container shrink-0 border-t border-line px-4 pt-3 pb-[max(12px,var(--safe-area-bottom,0px))] md:px-6 md:pb-4"
    >
      <div className="flex flex-col gap-3 @min-[620px]:flex-row @min-[620px]:items-start @min-[620px]:justify-between @min-[620px]:gap-8">
        <StreamQualityControl
          value={quality}
          onChange={onQualityChange}
          availableQualities={availableQualities}
        />
        <div className="flex min-w-0 items-start justify-between gap-3 @min-[620px]:max-w-56 @min-[620px]:justify-end">
          <div className="min-w-0">
            <Label
              htmlFor={audioId}
              className="gap-1.5 text-ui-sm font-medium text-ink-1"
            >
              <Icon name="voiceChannel" size="sm" className="text-ink-3" />
              Include audio
            </Label>
            {audioDescription ? (
              <p
                id={audioDescId}
                className="mt-1 text-ui-xs text-pretty text-ink-3"
              >
                {audioDescription}
              </p>
            ) : null}
          </div>
          <Switch
            id={audioId}
            checked={withAudio}
            onCheckedChange={onWithAudioChange}
            aria-describedby={audioDescription ? audioDescId : undefined}
            className="mt-0.5"
          />
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-3 border-t border-line pt-3 @min-[440px]:flex-row @min-[440px]:items-center">
        <div
          className={cn(
            "min-w-0 @min-[440px]:flex-1",
            !sourceName && "hidden @min-[440px]:block",
          )}
        >
          {sourceName ? (
            <>
              <p
                className={cn(
                  "truncate text-ui-sm",
                  sourcePicked
                    ? "font-semibold text-ink-1"
                    : "font-medium text-ink-3",
                )}
              >
                {sourceName}
              </p>
              {selected ? (
                <p className="text-ui-xs text-ink-3">
                  {selected.label} · {selected.fps} fps
                  {withAudio ? " · with audio" : ""}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="flex flex-col-reverse gap-2 @min-[440px]:flex-row @min-[440px]:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            className="pointer-coarse:min-h-11"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onStart}
            disabled={startDisabled}
            className="pointer-coarse:min-h-11"
          >
            Go live
          </Button>
        </div>
      </div>
    </div>
  );
}
