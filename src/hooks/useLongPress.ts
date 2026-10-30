import type React from "react";
import { useCallback, useEffect, useRef } from "react";

/**
 * Touch long-press, the phone's right click.
 *
 * A hand-rolled pointer hook rather than a library: it has to cancel on
 * `pointercancel` (the browser taking over to scroll), only listen to touch
 * pointers, keep the element and coordinates from the press start (React
 * clears `currentTarget` before a delayed callback runs), and swallow the
 * click that follows the release so a long press on a row doesn't also open
 * the row.
 */

export interface LongPressInfo {
  target: EventTarget | null;
  currentTarget: HTMLElement;
  clientX: number;
  clientY: number;
}

export interface LongPressOptions {
  /** Hold time in ms. iOS uses ~500; 450 feels prompt without misfires. */
  delay?: number;
  /** Movement in px that turns the press into a scroll/drag. */
  slop?: number;
  disabled?: boolean;
}

/**
 * On touch, stop iOS from showing its own callout/selection on the element
 * that owns a long-press menu. Desktop keeps text selection.
 */
export const LONG_PRESS_TARGET =
  "pointer-coarse:select-none pointer-coarse:[-webkit-touch-callout:none]";

/**
 * Returns `bind(context)`, which gives the pointer handlers for one element.
 * One hook instance can serve a whole list (only one primary touch presses
 * at a time); the context of the pressed element reaches the callback.
 *
 *   const bind = useLongPress((info, channel) => openMenuFor(channel, info));
 *   <button {...bind(channel)} />
 */
export function useLongPress<C = undefined>(
  onLongPress: ((info: LongPressInfo, context: C) => void) | undefined,
  { delay = 450, slop = 10, disabled = false }: LongPressOptions = {},
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const fired = useRef(false);
  const callback = useRef(onLongPress);

  useEffect(() => {
    callback.current = onLongPress;
  }, [onLongPress]);

  const clear = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);

  useEffect(() => clear, [clear]);

  const press = useCallback(
    (event: React.PointerEvent<HTMLElement>, context: C) => {
      if (disabled || !callback.current) return;
      if (event.pointerType !== "touch" || !event.isPrimary) return;
      clear();
      fired.current = false;
      const info: LongPressInfo = {
        target: event.target,
        currentTarget: event.currentTarget,
        clientX: event.clientX,
        clientY: event.clientY,
      };
      start.current = {
        x: event.clientX,
        y: event.clientY,
        id: event.pointerId,
      };
      timer.current = setTimeout(() => {
        timer.current = null;
        start.current = null;
        fired.current = true;
        navigator.vibrate?.(10);
        callback.current?.(info, context);
      }, delay);
    },
    [clear, delay, disabled],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const origin = start.current;
      if (!origin || event.pointerId !== origin.id) return;
      if (
        Math.abs(event.clientX - origin.x) > slop ||
        Math.abs(event.clientY - origin.y) > slop
      ) {
        clear();
      }
    },
    [clear, slop],
  );

  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (!fired.current) return;
    fired.current = false;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  return useCallback(
    (context: C) => ({
      onPointerDown: (event: React.PointerEvent<HTMLElement>) =>
        press(event, context),
      onPointerMove,
      onPointerUp: clear,
      onPointerCancel: clear,
      onClickCapture,
    }),
    [clear, onClickCapture, onPointerMove, press],
  );
}

/**
 * Bridge a long press to an existing `onContextMenu` handler, so a menu has
 * one entry point for right click, Android's native long-press contextmenu
 * and iOS (which never fires contextmenu on touch).
 */
export function useLongPressMenu<E extends HTMLElement = HTMLElement>(
  onContextMenu: ((event: React.MouseEvent<E>) => void) | undefined,
  options?: LongPressOptions,
) {
  const bind = useLongPress<undefined>(
    onContextMenu
      ? (info) => onContextMenu(toContextMenuEvent<E>(info))
      : undefined,
    options,
  );
  return bind(undefined);
}

/** A long press dressed as the MouseEvent a contextmenu handler expects. */
export function toContextMenuEvent<E extends HTMLElement = HTMLElement>(
  info: LongPressInfo,
): React.MouseEvent<E> {
  return {
    type: "contextmenu",
    target: info.target,
    currentTarget: info.currentTarget,
    clientX: info.clientX,
    clientY: info.clientY,
    button: 2,
    preventDefault: () => {},
    stopPropagation: () => {},
    isDefaultPrevented: () => false,
    isPropagationStopped: () => false,
    persist: () => {},
  } as unknown as React.MouseEvent<E>;
}
