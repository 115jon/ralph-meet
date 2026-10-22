/**
 * Settings row anatomy, shared by every panel.
 *
 *   card  ─ title, optional description, a list of rows divided by hairlines
 *   row   ─ label + description on the leading side, control on the trailing
 *           side; "stack" rows drop the control under the text when narrow,
 *           "block" rows always put it under (pickers, lists, meters)
 *
 * Labels and descriptions come from schema.ts. Every control is named by its
 * row: render functions receive the row's label and description ids.
 */

import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getRowLocation,
  getSectionDef,
  isRowAvailable,
  rowMatches,
  searchTokens,
  visibleSectionRows,
  type SettingsEnvironment,
} from "./schema";

/* ------------------------------------------------------------------ */
/* Context                                                              */
/* ------------------------------------------------------------------ */

export type SettingsContextValue = {
  env: SettingsEnvironment;
  /** Live search query; rows outside it are hidden in place. */
  query: string;
  /** Row id a search result or deep link landed on. */
  target: string | null;
  /**
   * Register an Escape handler that runs before the dialog's own (inline
   * confirms, search). Return true when the key was handled.
   */
  registerEscape: (handler: () => boolean) => () => void;
  openProfileEditor: (trigger?: HTMLElement) => void;
  openThemePreview: () => void;
};

const noop = () => () => {};

export const SettingsContext = createContext<SettingsContextValue>({
  env: { desktop: false },
  query: "",
  target: null,
  registerEscape: noop,
  openProfileEditor: () => {},
  openThemePreview: () => {},
});

export function useSettings() {
  return useContext(SettingsContext);
}

/** Run `handler` on Escape while `active`, ahead of closing the dialog. */
export function useSettingsEscape(active: boolean, handler: () => void) {
  const { registerEscape } = useSettings();
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  });
  useEffect(() => {
    if (!active) return undefined;
    return registerEscape(() => {
      handlerRef.current();
      return true;
    });
  }, [active, registerEscape]);
}

/* ------------------------------------------------------------------ */
/* Search highlight                                                     */
/* ------------------------------------------------------------------ */

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function Highlight({ text, query }: { text: string; query: string }) {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "ig");
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <mark
            key={index}
            className="rounded-[3px] bg-rm-accent-tint px-px text-inherit underline decoration-rm-accent-ink decoration-2 underline-offset-2"
          >
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Card                                                                 */
/* ------------------------------------------------------------------ */

export function SettingsCard({
  id,
  description,
  children,
  className,
}: {
  /** Section id from schema.ts. */
  id: string;
  /** Overrides the schema description (for dynamic copy). */
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { env, query } = useSettings();
  const titleId = useId();
  const entry = getSectionDef(id);
  if (!entry) return null;
  if (visibleSectionRows(id, env, query).length === 0) return null;
  const desc = description ?? entry.section.desc;
  return (
    <section
      aria-labelledby={titleId}
      data-section={id}
      className={cn(
        "rounded-lg border border-rm-border bg-rm-bg-surface shadow-[var(--rm-shadow-1)] dark:shadow-none",
        className,
      )}
    >
      <div className="px-4 pb-1 pt-4 @min-[560px]:px-5">
        <h4 id={titleId} className="text-ui-md font-semibold text-rm-text">
          {entry.section.title}
        </h4>
        {desc ? (
          <p className="mt-1 max-w-[62ch] text-pretty text-ui-sm text-rm-text-secondary">
            {desc}
          </p>
        ) : null}
      </div>
      <ul className="divide-y divide-rm-border">{children}</ul>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Row                                                                  */
/* ------------------------------------------------------------------ */

export type RowIds = { labelId: string; descId?: string };

export function SettingsRow({
  id,
  layout = "stack",
  disabled = false,
  hideLabel = false,
  description,
  footer,
  leading,
  children,
}: {
  /** Row id from schema.ts. */
  id: string;
  /**
   * inline: control always on the trailing side (switches, badges, buttons).
   * stack: control moves under the text when the page is narrow.
   * block: control always sits under the text, full width.
   */
  layout?: "inline" | "stack" | "block";
  disabled?: boolean;
  /** Keep the label for assistive tech only (self-describing controls). */
  hideLabel?: boolean;
  /** Overrides the schema description (links, live status). */
  description?: ReactNode;
  /** Full-width content under the row (inline confirms, errors, notes). */
  footer?: ReactNode;
  /** Decorative media before the label (an avatar). */
  leading?: ReactNode;
  children?: (ids: RowIds) => ReactNode;
}) {
  const { env, query, target } = useSettings();
  const labelId = useId();
  const descId = useId();
  const location = getRowLocation(id);
  if (!location || !isRowAvailable(id, env) || !rowMatches(id, query)) {
    return null;
  }
  const { row } = location;
  const desc = description ?? row.desc;
  const ids: RowIds = { labelId, descId: desc ? descId : undefined };
  const isTarget = target === id;

  return (
    <li
      data-row={id}
      data-target={isTarget || undefined}
      tabIndex={isTarget ? -1 : undefined}
      className="rm-settings-target scroll-my-6 px-4 py-3.5 outline-none @min-[560px]:px-5"
    >
      <div
        className={cn(
          "flex gap-x-6 gap-y-3",
          layout === "block"
            ? "flex-col"
            : layout === "inline"
              ? "flex-row items-center justify-between"
              : "flex-col @min-[560px]:flex-row @min-[560px]:items-center @min-[560px]:justify-between",
        )}
      >
        <div
          className={cn(
            "flex min-w-0 items-center gap-3",
            hideLabel && "sr-only",
          )}
        >
          {leading ? (
            <span aria-hidden="true" className="shrink-0">
              {leading}
            </span>
          ) : null}
          <div className="min-w-0">
            <p
              id={labelId}
              className={cn(
                "text-ui-base font-medium",
                disabled ? "text-rm-text-secondary" : "text-rm-text",
              )}
            >
              <Highlight text={row.label} query={query} />
            </p>
            {desc ? (
              <div
                id={descId}
                className="mt-0.5 max-w-[56ch] text-pretty text-ui-sm text-rm-text-secondary"
              >
                {typeof desc === "string" ? (
                  <Highlight text={desc} query={query} />
                ) : (
                  desc
                )}
              </div>
            ) : null}
          </div>
        </div>
        {children ? (
          <div
            className={cn(
              "min-w-0",
              layout === "block"
                ? "w-full"
                : layout === "inline"
                  ? "flex shrink-0 items-center justify-end gap-2"
                  : "flex w-full shrink-0 items-center gap-2 @min-[560px]:w-auto @min-[560px]:justify-end",
            )}
          >
            {children(ids)}
          </div>
        ) : null}
      </div>
      {footer}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Controls                                                             */
/* ------------------------------------------------------------------ */

export type SelectOption = {
  value: string;
  label: string;
  icon?: IconName;
};

export function SettingsSelect({
  ids,
  value,
  options,
  onValueChange,
  disabled,
  placeholder,
  renderLabel,
}: {
  ids: RowIds;
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  renderLabel?: (option: SelectOption) => ReactNode;
}) {
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        aria-labelledby={ids.labelId}
        aria-describedby={ids.descId}
        className="h-9 w-full min-w-0 @min-[560px]:w-[260px] [&>span]:min-w-0 [&>span]:truncate"
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent position="popper" align="end" className="max-w-[320px]">
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            textValue={option.label}
          >
            <span className="flex min-w-0 items-center gap-2">
              {option.icon ? (
                <Icon
                  name={option.icon}
                  size="sm"
                  className="shrink-0 text-rm-text-secondary"
                />
              ) : null}
              <span className="truncate">
                {renderLabel ? renderLabel(option) : option.label}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function RangeControl({
  ids,
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  disabled,
  unit = "%",
  className,
}: {
  ids: RowIds;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  unit?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-full items-center gap-3 @min-[560px]:w-[260px]",
        className,
      )}
    >
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-labelledby={ids.labelId}
        aria-describedby={ids.descId}
        aria-valuetext={`${value}${unit}`}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className="rm-settings-range min-w-0 flex-1"
      />
      <output
        aria-hidden="true"
        className="w-11 shrink-0 text-right text-ui-sm tabular-nums text-rm-text-secondary"
      >
        {value}
        {unit}
      </output>
    </div>
  );
}

export type RadioOption<V extends string> = {
  value: V;
  label: string;
  desc?: string;
  badge?: string;
};

/**
 * Native radios in a fieldset-like group: arrow keys move and select, the
 * browser handles focus. Named by the row label.
 */
export function RadioList<V extends string>({
  ids,
  name,
  value,
  options,
  onChange,
  disabled,
  busyValue,
}: {
  ids: RowIds;
  name: string;
  value: V;
  options: readonly RadioOption<V>[];
  onChange: (value: V) => void;
  disabled?: boolean;
  /** Shows a saving state on one option. */
  busyValue?: V | null;
}) {
  return (
    <div
      role="radiogroup"
      aria-labelledby={ids.labelId}
      aria-describedby={ids.descId}
      className="grid gap-2 @min-[560px]:grid-cols-[repeat(auto-fit,minmax(200px,1fr))]"
    >
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <label
            key={option.value}
            className={cn(
              "relative flex cursor-pointer gap-3 rounded-md border px-3 py-2.5 transition-[background-color,border-color] duration-150 ease-(--rm-ease-out) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-(--rm-focus)",
              checked
                ? "border-rm-accent-ink/60 bg-rm-accent-tint"
                : "border-rm-border-strong pointer-fine:hover:bg-rm-tint-1",
              disabled && "cursor-not-allowed opacity-45",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              disabled={disabled}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
                checked ? "border-primary bg-primary" : "border-rm-field-edge",
              )}
            >
              <span
                className={cn(
                  "size-1.5 rounded-full bg-primary-foreground transition-transform duration-150 ease-(--rm-ease-out)",
                  checked ? "scale-100" : "scale-0",
                )}
              />
            </span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-ui-sm font-medium text-rm-text">
                  {option.label}
                </span>
                {option.badge ? (
                  <span className="rounded-sm bg-rm-tint-2 px-1.5 text-ui-2xs font-medium leading-5 text-rm-text-secondary">
                    {option.badge}
                  </span>
                ) : null}
                {busyValue === option.value ? (
                  <span className="text-ui-xs text-rm-text-secondary">
                    Saving…
                  </span>
                ) : null}
              </span>
              {option.desc ? (
                <span className="mt-0.5 block text-ui-xs text-rm-text-secondary">
                  {option.desc}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function ComingLater() {
  return (
    <span className="inline-flex h-6 items-center rounded-full border border-rm-border-strong px-2.5 text-ui-xs font-medium text-rm-text-secondary">
      Coming later
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-sm border border-rm-border-strong bg-rm-tint-1 shadow-[inset_0_-1px_0_var(--rm-border-strong)] px-1.5 font-[inherit] text-ui-xs font-medium text-rm-text">
      {children}
    </kbd>
  );
}

export function ValueText({ children }: { children: ReactNode }) {
  return (
    <span className="min-w-0 truncate text-ui-sm text-rm-text-secondary">
      {children}
    </span>
  );
}

/** Inline error under a row or list. */
export function RowError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="mt-3 rounded-md bg-rm-danger-tint px-3 py-2 text-ui-sm text-rm-danger-ink"
    >
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Inline confirm                                                       */
/* ------------------------------------------------------------------ */

/**
 * Two-step destructive action without a modal. `arm()` from the trigger,
 * render <ConfirmStrip> where the consequence should appear. Escape or
 * Cancel puts focus back on the trigger.
 */
export function useConfirm() {
  const [armed, setArmed] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const arm = useCallback(() => setArmed(true), []);
  const cancel = useCallback(() => {
    setArmed(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  const done = useCallback(() => setArmed(false), []);
  useSettingsEscape(armed, cancel);
  return { armed, arm, cancel, done, triggerRef };
}

export function ConfirmStrip({
  consequence,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
}: {
  /** Names what will happen, in the person's terms. */
  consequence: string;
  /** Verb + object, matching the trigger. */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div
      role="group"
      aria-labelledby={messageId}
      className="rm-settings-confirm-in mt-3 flex flex-col gap-3 rounded-md border border-rm-border-strong bg-rm-tint-1 p-3 @min-[560px]:flex-row @min-[560px]:items-center @min-[560px]:justify-between"
    >
      <p id={messageId} className="text-pretty text-ui-sm text-rm-text">
        {consequence}
      </p>
      <div className="flex shrink-0 justify-end gap-2">
        <Button
          ref={cancelRef}
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
        <Button
          type="button"
          variant="danger"
          onClick={onConfirm}
          loading={busy}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Roving focus                                                         */
/* ------------------------------------------------------------------ */

/**
 * Arrow-key focus for a list of `[data-roving]` items inside the handler's
 * element. Up/Down (or Left/Right in a grid), Home and End. With `select`,
 * moving also activates the item, as radios do.
 */
export function rovingKeyDown(
  event: React.KeyboardEvent<HTMLElement>,
  options: { grid?: boolean; select?: boolean } = {},
) {
  const back = options.grid ? ["ArrowUp", "ArrowLeft"] : ["ArrowUp"];
  const forward = options.grid ? ["ArrowDown", "ArrowRight"] : ["ArrowDown"];
  const key = event.key;
  if (![...back, ...forward, "Home", "End"].includes(key)) return;
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>("[data-roving]"),
  ).filter((item) => !item.hasAttribute("disabled"));
  if (items.length === 0) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  let next = index;
  if (back.includes(key)) next = index <= 0 ? items.length - 1 : index - 1;
  if (forward.includes(key)) next = index >= items.length - 1 ? 0 : index + 1;
  if (key === "Home") next = 0;
  if (key === "End") next = items.length - 1;
  event.preventDefault();
  const target = items[next];
  target?.focus();
  if (options.select) target?.click();
}
