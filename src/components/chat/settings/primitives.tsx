/**
 * Settings row anatomy, shared by every panel (component kit, direction C).
 *
 *   card  ─ a C2 rule card: a 2px ink rule, the section's silkscreen legend
 *           and "02 / 04" index on it, an optional description, then rows
 *   row   ─ label + description on the leading side, control on the trailing
 *           side, a hairline under each; "stack" rows drop the control under
 *           the text when narrow, "block" rows always put it under (sliders,
 *           meters, segmented rails), "field" rows print the label across the
 *           top edge of the control (device pickers)
 *
 * Labels and descriptions come from schema.ts. Every control is named by its
 * row: render functions receive the row's label and description ids.
 */

import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { FieldPlate } from "@/components/ui/input";
import { Kbd as UiKbd } from "@/components/ui/kbd";
import { LedLabel } from "@/components/ui/led";
import { Num } from "@/components/ui/num";
import { RuleCard } from "@/components/ui/plate";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Slider } from "@/components/ui/slider";
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
  getSectionPosition,
  isRowAvailable,
  rowMatches,
  searchTokens,
  visibleSectionRows,
  type SettingsEnvironment,
} from "./schema";

const pad = (n: number) => String(n).padStart(2, "0");

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
            className="rounded-xs bg-accent-tint px-px text-inherit underline decoration-accent-ink decoration-2 underline-offset-2"
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
  title,
  description,
  actions,
  excludeSections,
  children,
  className,
}: {
  /** Section id from schema.ts. Optional when `title` is given. */
  id?: string;
  /**
   * Card title for surfaces outside the user-settings schema (server,
   * channel and room settings). Skips the schema lookup and search filter.
   */
  title?: ReactNode;
  /** Overrides the schema description (for dynamic copy). */
  description?: ReactNode;
  /** Trailing header control (an "Add" button). */
  actions?: ReactNode;
  /** Sections the host leaves out, so the "02 / 04" index stays honest. */
  excludeSections?: readonly string[];
  children: ReactNode;
  className?: string;
}) {
  const { env, query } = useSettings();
  const titleId = useId();
  const entry = id && title === undefined ? getSectionDef(id) : null;
  if (title === undefined) {
    if (!id || !entry) return null;
    if (visibleSectionRows(id, env, query).length === 0) return null;
  }
  const heading = title ?? entry?.section.title;
  const desc = description ?? entry?.section.desc;
  const position = entry
    ? getSectionPosition(entry.section.id, env, excludeSections)
    : null;
  const index = position
    ? `${pad(position.index)} / ${pad(position.total)}`
    : null;
  return (
    <RuleCard
      data-section={id}
      aria-labelledby={titleId}
      // The legend is the section's heading; its text stays real, the
      // silkscreen only prints it in capitals.
      legend={
        <span id={titleId} role="heading" aria-level={3}>
          {heading}
        </span>
      }
      index={
        actions ? (
          <span className="inline-flex items-center gap-3">
            <span className="flex items-center gap-2 tracking-normal normal-case [font-stretch:100%]">
              {actions}
            </span>
            {index}
          </span>
        ) : (
          index
        )
      }
      className={className}
    >
      {desc ? (
        <div className="max-w-[62ch] text-pretty text-ui-sm text-ink-2">
          {desc}
        </div>
      ) : null}
      <ul>{children}</ul>
    </RuleCard>
  );
}

/* ------------------------------------------------------------------ */
/* Row                                                                  */
/* ------------------------------------------------------------------ */

export type RowIds = {
  labelId: string;
  descId?: string;
  /** The row's label as text, for controls that take a string name. */
  label?: string;
  /** Put this on the control a "field" row's legend labels. */
  controlId?: string;
  /** The control sits in a legend plate: fill the width at 48px. */
  field?: boolean;
};

export function SettingsRow({
  id,
  label,
  layout = "stack",
  disabled = false,
  hideLabel = false,
  description,
  footer,
  leading,
  ground = "ply-0",
  children,
}: {
  /** Row id from schema.ts (or any stable id when `label` is given). */
  id: string;
  /**
   * Row label for surfaces outside the user-settings schema. Skips the
   * schema lookup, availability and search filter.
   */
  label?: ReactNode;
  /**
   * inline: control always on the trailing side (switches, badges, buttons).
   * stack: control moves under the text when the page is narrow.
   * block: control always sits under the text, full width.
   * field: the label is printed on the control's top edge (a legend plate);
   *   the description sits under it.
   */
  layout?: "inline" | "stack" | "block" | "field";
  disabled?: boolean;
  /** Keep the label for assistive tech only (self-describing controls). */
  hideLabel?: boolean;
  /** Overrides the schema description (links, live status). */
  description?: ReactNode;
  /** Full-width content under the row (inline confirms, errors, notes). */
  footer?: ReactNode;
  /** Decorative media before the label (an avatar). */
  leading?: ReactNode;
  /** The ground a "field" row's legend plate sits on (ply-3 in a dialog). */
  ground?: "ply-0" | "ply-1" | "ply-2" | "ply-3";
  children?: (ids: RowIds) => ReactNode;
}) {
  const { env, query, target } = useSettings();
  const labelId = useId();
  const descId = useId();
  const controlId = useId();
  const location = label === undefined ? getRowLocation(id) : null;
  if (
    label === undefined &&
    (!location || !isRowAvailable(id, env) || !rowMatches(id, query))
  ) {
    return null;
  }
  const row = location?.row;
  const desc = description ?? row?.desc;
  const field = layout === "field" && !hideLabel;
  const ids: RowIds = {
    labelId,
    descId: desc ? descId : undefined,
    label: typeof label === "string" ? label : row?.label,
    controlId: field ? controlId : undefined,
    field: field || undefined,
  };
  const isTarget = target === id;
  const labelNode = label ?? (
    <Highlight text={row?.label ?? ""} query={query} />
  );
  const descNode = desc ? (
    typeof desc === "string" ? (
      <Highlight text={desc} query={query} />
    ) : (
      desc
    )
  ) : null;

  return (
    <li
      data-row={id}
      data-target={isTarget || undefined}
      tabIndex={isTarget ? -1 : undefined}
      // The landing tint bleeds 12px past the column so the text keeps its
      // edge; the hairline lives on the inner block and stays in the column.
      className="rm-settings-target group/row -mx-3 scroll-my-6 px-3 outline-none"
    >
      <div className="border-b border-line py-4 group-last/row:border-b-0">
        {field ? (
          <>
            <FieldPlate
              label={<span id={labelId}>{labelNode}</span>}
              htmlFor={controlId}
              ground={ground}
            >
              {children ? children(ids) : null}
            </FieldPlate>
            {descNode ? (
              <div
                id={descId}
                className="mt-2 max-w-[62ch] text-pretty text-ui-sm text-ink-2"
              >
                {descNode}
              </div>
            ) : null}
          </>
        ) : (
          <div
            className={cn(
              "flex gap-x-4 gap-y-3",
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
                    "text-[15px] leading-5 font-medium",
                    disabled ? "text-ink-2" : "text-ink-1",
                  )}
                >
                  {labelNode}
                </p>
                {descNode ? (
                  <div
                    id={descId}
                    className="mt-0.5 max-w-[60ch] text-pretty text-ui-sm text-ink-2"
                  >
                    {descNode}
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
        )}
        {footer}
      </div>
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
  /**
   * A 12px meta line under the label in the open list ("System default").
   * The trigger shows the label alone.
   */
  meta?: string;
};

/**
 * The select for a row. In a "field" row (`ids.field`) it is the 48px legend
 * plate control, full width; in any other row it is a 40px trigger on the
 * trailing side.
 */
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
  const selected = options.find((option) => option.value === value);
  return (
    <Select value={value} onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger
        id={ids.controlId}
        size={ids.field ? "lg" : "default"}
        aria-labelledby={ids.labelId}
        aria-describedby={ids.descId}
        title={selected?.label}
        className={cn(
          "w-full min-w-0 [&>span]:min-w-0 [&>span]:truncate",
          !ids.field && "@min-[560px]:w-[240px]",
        )}
      >
        <SelectValue placeholder={placeholder}>
          {selected ? (
            <span className="flex min-w-0 items-center gap-2">
              {selected.icon ? (
                <Icon
                  name={selected.icon}
                  size="sm"
                  className="shrink-0 text-ink-3"
                />
              ) : null}
              <span className="truncate">
                {renderLabel ? renderLabel(selected) : selected.label}
              </span>
            </span>
          ) : undefined}
        </SelectValue>
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
                  className="shrink-0 text-ink-3"
                />
              ) : null}
              <span className="flex min-w-0 flex-col">
                <span className="truncate">
                  {renderLabel ? renderLabel(option) : option.label}
                </span>
                {option.meta ? (
                  <span className="truncate text-ui-xs font-normal text-ink-3">
                    {option.meta}
                  </span>
                ) : null}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A value fader: the C1 dither slider with a Martian readout. The thumb is
 * the focusable `role="slider"`, so it takes the row's label and description
 * ids directly (the primitive only forwards `aria-label` to it).
 */
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
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const thumb = ref.current?.querySelector<HTMLElement>('[role="slider"]');
    if (!thumb) return;
    thumb.setAttribute("aria-labelledby", ids.labelId);
    if (ids.descId) thumb.setAttribute("aria-describedby", ids.descId);
    else thumb.removeAttribute("aria-describedby");
  }, [ids.labelId, ids.descId]);
  return (
    <div ref={ref} className={cn("flex w-full items-center gap-4", className)}>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        disabled={disabled}
        aria-label={ids.label}
        getAriaValueText={(next) => `${next}${unit}`}
        onValueChange={([next]) => {
          if (next !== undefined) onChange(next);
        }}
        className="min-w-0 flex-1"
      />
      <Num
        size="sm"
        aria-hidden="true"
        className={cn(
          "w-12 shrink-0 text-right font-semibold",
          disabled ? "text-ink-3" : "text-ink-1",
        )}
      >
        {value}
        {unit}
      </Num>
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
 * A selectable card: a 2px corner, a line edge, a tint-1 hover. Selected:
 * a 2px ink-1 edge and the Fill weight of its icon. Text cards lead with a
 * 16px radio; pass `icon` for a glyph instead. It wraps a native input, so
 * arrow keys, focus and forms behave as the browser's own radio or checkbox.
 * (Studio's own choices use `SegmentedField`; this stays for dialogs that
 * list options with long descriptions.)
 */
function ChoiceCard({
  type = "radio",
  name,
  value,
  checked,
  disabled = false,
  onChange,
  label,
  description,
  badge,
  icon,
  status,
  className,
}: {
  type?: "radio" | "checkbox";
  name?: string;
  value?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: ReactNode;
  description?: ReactNode;
  /** A short tag after the label ("Recommended"). */
  badge?: ReactNode;
  /** A leading glyph in place of the radio (drawn Fill when selected). */
  icon?: IconName;
  /** Trailing status after the label ("Saving…"). */
  status?: ReactNode;
  className?: string;
}) {
  return (
    <label
      data-slot="choice-card"
      data-checked={checked || undefined}
      className={cn(
        "relative flex cursor-pointer gap-2.5 rounded-[2px] border p-3 transition-[background-color,border-color] duration-(--dur-1) ease-out has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
        checked
          ? "border-ink-1 bg-tint-1 shadow-[inset_0_0_0_1px_var(--ink-1)]"
          : "border-line-strong pointer-fine:hover:bg-tint-1",
        disabled && "cursor-not-allowed opacity-45",
        className,
      )}
    >
      <input
        type={type}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="peer sr-only"
      />
      {icon ? (
        <Icon
          name={icon}
          size="sm"
          state={checked ? ("active" as never) : undefined}
          className={cn(
            "mt-0.5 shrink-0",
            checked ? "text-ink-1" : "text-ink-2",
          )}
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "mt-0.5 flex size-4 shrink-0 items-center justify-center border-2",
            type === "checkbox" ? "rounded-[2px]" : "rounded-full",
            checked ? "border-ink-1" : "border-ink-2",
          )}
        >
          <span
            className={cn(
              "size-1.5 bg-ink-1 transition-[scale] duration-(--dur-2) ease-out",
              type === "checkbox" ? "rounded-[1px]" : "rounded-full",
              checked ? "scale-100" : "scale-0",
            )}
          />
        </span>
      )}
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-ui-row font-medium text-ink-1">{label}</span>
          {badge ? (
            <span className="silkscreen inline-flex h-5 items-center border border-line-strong px-1.5 text-ink-2">
              {badge}
            </span>
          ) : null}
          {status ? (
            <span className="text-ui-xs text-ink-3">{status}</span>
          ) : null}
        </span>
        {description ? (
          <span className="mt-0.5 block text-pretty text-ui-xs text-ink-2">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/**
 * Native radios as choice cards: arrow keys move and select, the browser
 * handles focus. Named by the row label.
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
    // Its own container: three across once the row itself is 560 wide (no
    // orphan third card), one column below, whatever the page width.
    <div className="@container/choices">
      <div
        role="radiogroup"
        aria-labelledby={ids.labelId}
        aria-describedby={ids.descId}
        className={cn(
          "grid grid-cols-1 gap-2",
          // Whole rows only: two or four options pair up, the rest go three
          // across, so no card sits alone on its own row.
          options.length === 2 || options.length === 4
            ? "@min-[560px]/choices:grid-cols-2"
            : "@min-[560px]/choices:grid-cols-3",
        )}
      >
        {options.map((option) => (
          <ChoiceCard
            key={option.value}
            name={name}
            value={option.value}
            checked={option.value === value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
            label={option.label}
            description={option.desc}
            badge={option.badge}
            status={busyValue === option.value ? "Saving…" : undefined}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Two to four choices as the C1 segmented rail, with the chosen option's
 * description (and tag) printed under it. Named by the row label; the
 * description under the rail is the group's accessible description.
 */
export function SegmentedField<V extends string>({
  ids,
  value,
  options,
  onChange,
  disabled,
  busyValue,
  className,
}: {
  ids: RowIds;
  value: V;
  options: readonly RadioOption<V>[];
  onChange: (value: V) => void;
  disabled?: boolean;
  /** Shows a saving state next to the chosen option's description. */
  busyValue?: V | null;
  className?: string;
}) {
  const noteId = useId();
  const chosen = options.find((option) => option.value === value);
  const describedBy =
    [ids.descId, chosen?.desc ? noteId : undefined].filter(Boolean).join(" ") ||
    undefined;
  return (
    <div className={cn("flex w-full flex-col gap-3", className)}>
      <SegmentedControl
        label={ids.label ?? ""}
        items={options.map((option) => ({
          value: option.value,
          label: option.label,
        }))}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        aria-describedby={describedBy}
        // `text-control` is dropped when the cell's ink colour merges in
        // (tailwind-merge reads it as a colour), so the cells' Bricolage 600
        // label is restated here.
        className="w-full [&_[role=radio]]:font-display [&_[role=radio]]:text-[15px] [&_[role=radio]]:leading-none [&_[role=radio]]:font-semibold [&_[role=radio]]:[font-optical-sizing:auto]"
      />
      {chosen?.desc || chosen?.badge || busyValue ? (
        <p
          id={noteId}
          aria-live="polite"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 text-pretty text-ui-sm text-ink-2"
        >
          {chosen?.badge ? (
            <span className="silkscreen inline-flex h-5 items-center border border-line-strong px-1.5 text-ink-2">
              {chosen.badge}
            </span>
          ) : null}
          {chosen?.desc ? <span>{chosen.desc}</span> : null}
          {busyValue ? (
            <LedLabel state="idle" className="h-5">
              Saving…
            </LedLabel>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/** A status word for rows whose control hasn't shipped yet. */
export function ComingLater() {
  return (
    <LedLabel state="off" tone="plain">
      Coming later
    </LedLabel>
  );
}

/** A key cap: the foundation `Kbd` (text-num-xs, h-5, radius 4, tint-2). */
export function Kbd({ children }: { children: ReactNode }) {
  return <UiKbd>{children}</UiKbd>;
}

export function ValueText({ children }: { children: ReactNode }) {
  return (
    <span className="min-w-0 truncate text-ui-row text-ink-2">{children}</span>
  );
}

/** Inline error under a row or list. */
export function RowError({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p
      role="alert"
      className={cn(
        "mt-3 flex items-start gap-2 rounded-[2px] border-l-2 border-danger-ink bg-danger-tint px-3 py-2 text-ui-sm text-danger-ink",
        className,
      )}
    >
      <Icon name="warning" size="sm" className="mt-px shrink-0" />
      <span className="min-w-0">{children}</span>
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
  irreversible = false,
  error,
}: {
  /** Names what will happen, in the person's terms. */
  consequence: ReactNode;
  /** Verb + object, matching the trigger. */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  /**
   * Solid danger fill for actions that can't be undone (delete, revoke).
   * Reversible ones (sign out, unban) use the red tint (1.1, 13.2).
   */
  irreversible?: boolean;
  /** Failure copy; the strip stays open so the person can retry. */
  error?: ReactNode;
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
      className={cn(
        "rm-settings-confirm-in mt-3 flex flex-col gap-3 rounded-[2px] border-l-2 bg-tint-1 p-3 @min-[560px]:flex-row @min-[560px]:flex-wrap @min-[560px]:items-center @min-[560px]:justify-between",
        irreversible ? "border-danger-ink" : "border-ink-1",
      )}
    >
      <p id={messageId} className="text-pretty text-ui-sm text-ink-1">
        {consequence}
      </p>
      {/* ms-auto keeps the buttons right-aligned when they wrap under a
          long consequence or a confirm field. */}
      <div className="ms-auto flex shrink-0 justify-end gap-2">
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
          variant={irreversible ? "danger" : "destructive"}
          onClick={onConfirm}
          loading={busy}
        >
          {confirmLabel}
        </Button>
      </div>
      {error ? (
        <div className="w-full">
          <RowError className="mt-0">{error}</RowError>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Roving focus                                                         */
/* ------------------------------------------------------------------ */

/**
 * Roving tabindex: makes `target` the list's one tab stop (tabindex 0, the
 * rest -1) and focuses it. Moving the stop before focusing matters: the
 * global `[tabindex="-1"]:focus-visible` rule hides the ring on
 * programmatic focus targets, so an item still at -1 would get no ring.
 */
export function focusRovingItem(
  container: HTMLElement,
  target: HTMLElement | null | undefined,
) {
  if (!target) return;
  for (const item of container.querySelectorAll<HTMLElement>("[data-roving]")) {
    item.tabIndex = item === target ? 0 : -1;
  }
  target.focus();
}

/**
 * Arrow-key focus for a list of `[data-roving]` items inside the handler's
 * element. Up/Down (or Left/Right in a grid), Home and End. With `select`,
 * moving also activates the item, as radios do. Focus moves as a roving
 * tabindex (see `focusRovingItem`) so the target shows the focus ring.
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
  focusRovingItem(event.currentTarget, target);
  if (options.select) target?.click();
}
