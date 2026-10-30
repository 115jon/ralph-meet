/**
 * Purpose-built picker for one collectible slot (decoration, effect,
 * nameplate or frame), opened from the profile editor.
 *
 * It is a nested Dialog, not a body portal: the old catalog sat outside the
 * editor's modal Dialog, so it was aria-hidden, Escape went to the editor and
 * the editor's focus trap pulled focus out of its search field. As the topmost
 * layer it owns scroll lock, focus, Escape and the back button.
 *
 * Phones: full screen, header, sticky preview band, one scrolling list,
 * Apply in a bottom bar above the home indicator. md+: the workbench shell
 * (WORKBENCH_SURFACE): header across the top, preview pane left, list right,
 * and a footer along the whole bottom edge (preview name left, Cancel and
 * Apply right).
 */

import { Button } from "@/components/ui/button";
import { describeApiError } from "@/lib/api-errors";
import {
  Dialog,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogSurface,
  DialogTitle,
} from "@/components/ui/dialog";
import { WORKBENCH_SURFACE } from "@/components/chat/settings/SettingsWorkbench";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/input";
import { Num } from "@/components/ui/num";
import { Skeleton } from "@/components/ui/skeleton";
import type { AvatarDisplay } from "@/lib/avatar-display";
import {
  applyCollectible,
  type CollectibleApplyUser,
} from "@/lib/collectible-apply-client";
import {
  buildCollectionSections,
  collectionStatus,
  countSectionItems,
  findItemBySku,
  KIND_COPY,
} from "@/lib/collectible-catalog-view";
import {
  displayWithCollectible,
  selectedSkuForKind,
} from "@/lib/collectible-selection";
import type {
  CollectibleCatalogItem,
  CollectibleKind,
} from "@/lib/collectibles-catalog";
import { cn } from "@/lib/utils";
import { HIT, PRESS } from "@/components/ui/interaction";
import {
  useCallback,
  useDeferredValue,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  CollectibleListbox,
  NONE_OPTION_ID,
  type OptionVisualState,
} from "./CollectibleListbox";
import {
  CollectibleStage,
  DecorationAvatar,
  EffectThumb,
  FrameThumb,
  NameplateRow,
  type PreviewIdentity,
} from "./CollectiblePreviews";
import { useCollectiblesCatalog } from "./hooks";

export type CollectiblePickerProps = {
  open: boolean;
  kind: CollectibleKind;
  currentDisplay?: AvatarDisplay | string | null;
  avatarSrc?: string;
  displayName: string;
  username?: string;
  onClose: () => void;
  onApplied: (
    user: CollectibleApplyUser,
    appliedKinds: CollectibleKind[],
  ) => void | Promise<void>;
};

/** Whole cells packed edge to edge; the selected cell takes the ring. */
const GRID_CLASS: Record<CollectibleKind, string> = {
  avatar_decoration: "grid grid-cols-[repeat(auto-fill,minmax(88px,1fr))]",
  profile_effect: "grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))]",
  nameplate: "grid grid-cols-1 md:grid-cols-2",
  profile_frame: "grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))]",
};

/** The check disc on the chosen cell (accent fill, Bold glyph). */
function SelectedMark() {
  return (
    <span
      aria-hidden="true"
      className="absolute end-1.5 top-1.5 z-10 flex size-5 items-center justify-center rounded-full bg-accent-ink text-ply-0"
    >
      <Icon name="check" size="xs" />
    </span>
  );
}

/**
 * One cell: hover is tint-1, the chosen cell gets the accent ring and the
 * check disc. No per-cell card, border or pill.
 */
function cellClass(selected: boolean, extra?: string) {
  return cn(
    "relative flex h-full flex-col rounded-lg p-2 transition-colors duration-(--dur-1) ease-out",
    selected
      ? "ring-2 ring-accent-ink ring-inset"
      : "pointer-fine:group-hover/option:bg-tint-1",
    extra,
  );
}

function CellCaption({
  children,
  equipped,
}: {
  children: ReactNode;
  equipped: boolean;
}) {
  return (
    <span className="mt-1.5 flex flex-col items-center px-0.5 text-center">
      <span className="line-clamp-2 text-ui-xs text-ink-2">{children}</span>
      {equipped ? (
        <span className="text-ui-xs font-medium text-ink-3">Equipped</span>
      ) : null}
    </span>
  );
}

function NoneGlyph() {
  return (
    <span className="absolute inset-0 flex items-center justify-center text-ink-3">
      <Icon name="close" size="lg" />
    </span>
  );
}

/**
 * Cells render stills at rest. Animated art plays only for the cell under
 * the pointer or keyboard focus; the chosen item plays in the preview pane.
 */
function useRenderOption(
  kind: CollectibleKind,
  identity: PreviewIdentity,
  noneLabel: string,
) {
  return useCallback(
    (item: CollectibleCatalogItem | null, state: OptionVisualState) => {
      const caption = item ? item.name : noneLabel;
      const mark = state.selected ? <SelectedMark /> : null;
      if (kind === "avatar_decoration") {
        return (
          <span className={cellClass(state.selected)}>
            {mark}
            <span className="mx-auto w-full max-w-[76px] p-[12%]">
              <DecorationAvatar
                item={item}
                identity={identity}
                animate={state.active}
              />
            </span>
            <CellCaption equipped={state.equipped}>{caption}</CellCaption>
          </span>
        );
      }
      if (kind === "profile_effect") {
        return (
          <span className={cellClass(state.selected)}>
            {mark}
            <span className="relative">
              <EffectThumb item={item} />
              {item ? null : <NoneGlyph />}
            </span>
            <CellCaption equipped={state.equipped}>{caption}</CellCaption>
          </span>
        );
      }
      if (kind === "profile_frame") {
        return (
          <span className={cellClass(state.selected)}>
            {mark}
            <span className="relative px-[10%] pt-[14%] pb-[8%]">
              <FrameThumb item={item} identity={identity} />
            </span>
            <CellCaption equipped={state.equipped}>{caption}</CellCaption>
          </span>
        );
      }
      return (
        <span className={cellClass(state.selected, "min-h-[72px] gap-1.5")}>
          <NameplateRow
            item={item}
            identity={identity}
            animate={state.active}
          />
          <span className="flex items-center gap-2 px-1 text-ui-xs text-ink-2">
            <span className="min-w-0 truncate">{caption}</span>
            {state.equipped ? (
              <span className="ms-auto shrink-0 font-medium text-ink-3">
                Equipped
              </span>
            ) : null}
            {state.selected ? (
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full bg-accent-ink text-ply-0",
                  !state.equipped && "ms-auto",
                )}
              >
                <Icon name="check" size="xs" />
              </span>
            ) : null}
          </span>
        </span>
      );
    },
    [identity, kind, noneLabel],
  );
}

/** Name, collection and status of the previewed item. */
function PreviewCaption({
  name,
  meta,
  status,
  className,
}: {
  name: string;
  meta: string;
  status: string | null;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)} aria-live="polite">
      <p className="truncate text-ui-row font-medium text-ink-1">{name}</p>
      <p className="truncate text-ui-xs text-ink-3">
        {meta}
        {status ? <span className="text-warning-ink"> · {status}</span> : null}
      </p>
    </div>
  );
}

export function CollectiblePicker({
  open,
  kind,
  currentDisplay,
  avatarSrc,
  displayName,
  username,
  onClose,
  onApplied,
}: CollectiblePickerProps) {
  const { catalog, error: loadError, loading } = useCollectiblesCatalog();
  const copy = KIND_COPY[kind];
  const searchId = useId();
  const sectionIdPrefix = `${useId()}-section-`;
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const equippedSku = selectedSkuForKind(currentDisplay, kind) ?? null;
  const equippedItem = findItemBySku(catalog, kind, equippedSku);
  const equippedId = equippedItem?.id ?? null;
  const selectedId = draftId ?? equippedId ?? NONE_OPTION_ID;

  const sections = useMemo(
    () =>
      buildCollectionSections(catalog, { kinds: [kind], query: deferredQuery }),
    [catalog, deferredQuery, kind],
  );
  const allSections = useMemo(
    () => buildCollectionSections(catalog, { kinds: [kind] }),
    [catalog, kind],
  );
  const resultCount = countSectionItems(sections);

  const previewItem =
    selectedId === NONE_OPTION_ID
      ? null
      : (catalog?.items.find((item) => item.id === selectedId) ?? equippedItem);
  const previewDisplay = useMemo(
    () => displayWithCollectible(currentDisplay, kind, previewItem),
    [currentDisplay, kind, previewItem],
  );
  const identity = useMemo<PreviewIdentity>(
    () => ({ avatarSrc, displayName, username, display: currentDisplay }),
    [avatarSrc, currentDisplay, displayName, username],
  );
  const renderOption = useRenderOption(kind, identity, copy.noneLabel);

  const changed = selectedId !== (equippedId ?? NONE_OPTION_ID);
  const previewCategory = previewItem
    ? catalog?.categories.find(
        (category) => category.id === previewItem.categoryId,
      )
    : null;
  const previewStatus = previewCategory
    ? collectionStatus(previewCategory)
    : null;

  const handleChoose = useCallback((item: CollectibleCatalogItem | null) => {
    setApplyError(null);
    setDraftId(item ? item.id : NONE_OPTION_ID);
  }, []);

  const handleApply = async () => {
    if (!changed || applying) return;
    setApplying(true);
    setApplyError(null);
    try {
      const result = await applyCollectible({
        catalog,
        kind,
        item: previewItem,
        currentDisplay,
      });
      await onApplied(result.user, result.appliedKinds);
      onClose();
    } catch (err) {
      setApplyError(describeApiError(err, "apply that"));
    } finally {
      setApplying(false);
    }
  };

  const jumpTo = (categoryId: string) => {
    document
      .getElementById(`${sectionIdPrefix}${categoryId}`)
      ?.scrollIntoView({ block: "start" });
  };

  const previewName = previewItem ? previewItem.name : copy.noneLabel;
  const previewMeta = previewItem
    ? previewItem.categoryName
    : "Your profile without one";
  const total = allSections.length ? countSectionItems(allSections) : 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPortal>
        {/* Opened over the profile editor, the primitive stacks it: the light
            scrim and z-60 here, and the editor recedes. */}
        <DialogOverlay className="max-md:hidden" />
        <DialogSurface
          showCloseButton={false}
          initialFocus="surface"
          className={cn(WORKBENCH_SURFACE, "z-50 flex-col")}
        >
          {/* Header: title 16/600, close 28/16 inline at the end. */}
          <header className="flex shrink-0 items-center gap-2 border-b border-line px-2 pt-[calc(var(--safe-area-top,env(safe-area-inset-top,0px))+0.5rem)] pb-2 md:h-14 md:px-5 md:py-0">
            <IconButton
              icon="back"
              aria-label="Back to profile"
              variant="ghost"
              size={40}
              onClick={onClose}
              className="md:hidden"
            />
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate">{copy.pickerTitle}</DialogTitle>
              <DialogDescription className="truncate text-ui-xs text-ink-3">
                {catalog ? (
                  <>
                    <Num>{total.toLocaleString()}</Num> to choose from
                  </>
                ) : (
                  "Loading the catalog"
                )}
              </DialogDescription>
            </div>
            <IconButton
              icon="close"
              aria-label="Close"
              variant="ghost"
              size={28}
              onClick={onClose}
              className="max-md:hidden"
            />
          </header>

          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            {/* Preview: a band on phones, the left pane on desktop. */}
            <aside
              aria-label="Preview"
              className="flex shrink-0 items-center gap-4 border-b border-line bg-ply-1 px-4 py-3 md:w-[340px] md:flex-col md:justify-center md:border-e md:border-b-0 md:px-6 md:py-8"
            >
              <div className="flex shrink-0 items-center justify-center md:min-h-0 md:w-full md:flex-1">
                <CollectibleStage
                  kind={kind}
                  identity={identity}
                  item={previewItem}
                  display={previewDisplay}
                />
              </div>
              {kind === "nameplate" ? null : (
                <PreviewCaption
                  name={previewName}
                  meta={previewMeta}
                  status={previewStatus?.label ?? null}
                  className="flex-1 md:hidden"
                />
              )}
            </aside>

            {/* List */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [touch-action:pan-y] [scroll-padding-top:7rem]">
              <div className="sticky top-0 z-20 flex flex-col gap-2 border-b border-line bg-ply-0 px-3 py-3 md:px-5">
                <label htmlFor={searchId} className="sr-only">
                  Search {copy.many.toLowerCase()}
                </label>
                <div className="relative">
                  <Icon
                    name="search"
                    size="sm"
                    className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-3"
                  />
                  <Input
                    id={searchId}
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={`Search ${copy.many.toLowerCase()}`}
                    enterKeyHint="search"
                    autoComplete="off"
                    className="ps-8 max-md:h-10"
                  />
                </div>
                {!deferredQuery && allSections.length > 1 ? (
                  <nav
                    aria-label="Collections"
                    className="-mx-3 flex snap-x gap-1 overflow-x-auto px-3 [scrollbar-width:none] [touch-action:pan-x] md:-mx-5 md:px-5"
                  >
                    {allSections.map((section) => (
                      <button
                        key={section.category.id}
                        type="button"
                        onClick={() => jumpTo(section.category.id)}
                        className={cn(
                          "h-7 shrink-0 snap-start rounded-sm bg-tint-1 px-2.5 text-ui-sm font-medium whitespace-nowrap text-ink-2 outline-none pointer-fine:hover:text-ink-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                          PRESS,
                          HIT,
                        )}
                      >
                        {section.category.name}
                      </button>
                    ))}
                  </nav>
                ) : null}
                <p className="sr-only" role="status">
                  {deferredQuery
                    ? `${resultCount} ${resultCount === 1 ? "result" : "results"}`
                    : ""}
                </p>
              </div>

              <div className="px-3 pt-3 pb-6 md:px-5">
                {loading ? (
                  <div
                    className={cn(GRID_CLASS[kind], "gap-2")}
                    aria-hidden="true"
                  >
                    {Array.from({ length: 12 }, (_, index) => (
                      <Skeleton
                        key={index}
                        className={cn(
                          "rounded-lg",
                          kind === "nameplate" ? "h-[72px]" : "aspect-[3/4]",
                        )}
                      />
                    ))}
                  </div>
                ) : !catalog ? (
                  <EmptyState
                    size="sm"
                    className="pt-12"
                    title="The catalog didn't load"
                    description={
                      loadError ?? "Check your connection, then open it again."
                    }
                  />
                ) : (
                  <CollectibleListbox
                    label={copy.many}
                    sections={sections}
                    noneLabel={deferredQuery ? undefined : copy.noneLabel}
                    selectedId={selectedId}
                    equippedId={equippedId}
                    onChoose={handleChoose}
                    renderOption={renderOption}
                    gridClassName={GRID_CLASS[kind]}
                    sectionIdPrefix={sectionIdPrefix}
                    emptyState={
                      <EmptyState
                        size="sm"
                        art={null}
                        title={`Nothing matches “${deferredQuery}”`}
                        description="Try a collection name or a shorter word."
                      />
                    }
                  />
                )}
              </div>
            </div>
          </div>

          {/* Footer: the whole bottom edge. Preview left, actions right. */}
          <footer className="flex shrink-0 items-center gap-2 border-t border-line bg-ply-0 px-3 pt-3 pb-[calc(var(--safe-area-bottom,env(safe-area-inset-bottom,0px))+0.75rem)] md:px-5 md:py-3">
            <PreviewCaption
              name={previewName}
              meta={previewMeta}
              status={previewStatus?.label ?? null}
              className="me-auto max-md:hidden"
            />
            {applyError ? (
              <p
                role="alert"
                className="min-w-0 text-ui-xs text-danger-ink max-md:me-auto md:max-w-80 md:text-end"
              >
                {applyError}
              </p>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className={cn("max-md:h-11", !applyError && "max-md:me-auto")}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleApply}
              disabled={!changed}
              loading={applying}
              className="max-md:h-11 max-md:flex-1"
            >
              {selectedId === NONE_OPTION_ID && changed ? "Remove" : "Apply"}
            </Button>
          </footer>
        </DialogSurface>
      </DialogPortal>
    </Dialog>
  );
}
