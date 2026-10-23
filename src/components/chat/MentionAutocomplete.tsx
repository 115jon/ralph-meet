import * as React from "react";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";

import {
  MENU_ITEM,
  MENU_ITEM_DEFAULT_ON,
  MENU_LABEL,
  MENU_PANEL,
} from "@/components/ui/menu";
import { FLOATING_LAYER_ATTR } from "@/components/ui/popover";
import { getDisplayInitial } from "@/lib/display-name";
import { getAuthAssetUrl } from "@/lib/platform";
import type { User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AvatarImage } from "./AvatarImage";
import { UserDisplayName } from "./UserDisplayName";

/** id of the option row `index` in the list `listId` (for aria-activedescendant). */
export function mentionOptionId(listId: string, index: number) {
  return `${listId}-option-${index}`;
}

/**
 * The @mention list above the composer: a portalled `MENU_PANEL` listbox on
 * the modal layer (12.7), anchored to the composer.
 *
 * Focus never leaves the textarea: it owns ArrowUp/Down/Enter/Tab/Escape
 * (useMessageInput) and points `aria-activedescendant` at the active row. So
 * this uses the Base UI popover parts directly rather than `PopoverContent`,
 * whose focus scope and dialog-stack entry would pull focus into the panel.
 * Phones keep the same anchored panel: a drawer would cover the keyboard and
 * break the type-to-filter flow.
 */
export function MentionAutocomplete({
  mentionQuery,
  mentionCandidates,
  mentionIndex,
  setLocalState,
  insertMention,
  anchor,
  listId: listIdProp,
}: {
  mentionQuery: any;
  mentionCandidates: User[];
  mentionIndex: number;
  setLocalState: React.Dispatch<any>;
  insertMention: (user: User) => void;
  /** The composer the list sits above. Defaults to the list's own host. */
  anchor?: React.RefObject<Element | null>;
  /** id for the listbox; option ids derive from it (`mentionOptionId`). */
  listId?: string;
}) {
  const generatedId = React.useId();
  const listId = listIdProp ?? generatedId;
  const labelId = `${listId}-label`;
  const hostRef = React.useRef<HTMLSpanElement>(null);
  const open = !!mentionQuery && mentionCandidates.length > 0;

  return (
    <>
      {/* Fallback anchor when the host doesn't pass one. */}
      {anchor ? null : (
        <span ref={hostRef} aria-hidden="true" className="block h-0 w-full" />
      )}
      <PopoverPrimitive.Root
        open={open}
        onOpenChange={(nextOpen, details) => {
          if (nextOpen) return;
          const target = details.event?.target;
          const anchorElement = anchor ? anchor.current : hostRef.current;
          if (
            details.reason === "outside-press" &&
            target instanceof Node &&
            anchorElement?.contains(target)
          ) {
            // Clicks in the composer keep the list; the textarea decides.
            details.cancel();
            return;
          }
          setLocalState({ mentionQuery: null });
        }}
      >
        <PopoverPrimitive.Portal
          {...{ [FLOATING_LAYER_ATTR]: "" }}
          className="pointer-events-auto"
        >
          <PopoverPrimitive.Positioner
            anchor={anchor ?? hostRef}
            side="top"
            align="start"
            sideOffset={8}
            collisionPadding={8}
            className="z-50 outline-none"
          >
            <PopoverPrimitive.Popup
              initialFocus={false}
              finalFocus={false}
              className={cn(
                MENU_PANEL,
                "flex max-h-[min(320px,var(--available-height))] w-64 max-w-(--available-width) flex-col overflow-y-auto text-rm-text outline-none",
                "origin-(--transform-origin) transition-[opacity,scale] duration-150 ease-(--rm-ease-out) data-ending-style:scale-[0.97] data-ending-style:opacity-0 data-starting-style:scale-[0.97] data-starting-style:opacity-0 motion-reduce:transition-opacity",
              )}
            >
              <p id={labelId} className={MENU_LABEL}>
                Members
              </p>
              <div role="listbox" id={listId} aria-labelledby={labelId}>
                {mentionCandidates.map((user, i) => {
                  const active = i === mentionIndex;
                  return (
                    <div
                      key={user.id}
                      id={mentionOptionId(listId, i)}
                      role="option"
                      aria-selected={active}
                      // Keep focus (and the caret) in the textarea.
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setLocalState({ mentionIndex: i });
                        insertMention(user);
                      }}
                      onMouseEnter={() => setLocalState({ mentionIndex: i })}
                      className={cn(
                        MENU_ITEM,
                        "cursor-default",
                        active ? MENU_ITEM_DEFAULT_ON : "text-rm-text",
                      )}
                    >
                      <span className="flex size-6 shrink-0 items-center justify-center overflow-visible rounded-full border border-rm-border bg-rm-bg-surface text-ui-2xs font-semibold text-rm-text-muted">
                        {user.avatar_url ? (
                          <AvatarImage
                            src={getAuthAssetUrl(user.avatar_url)}
                            alt=""
                            display={user.avatar_display}
                          />
                        ) : (
                          getDisplayInitial(user)
                        )}
                      </span>
                      <UserDisplayName
                        user={user}
                        className="block min-w-0 truncate"
                      />
                    </div>
                  );
                })}
              </div>
            </PopoverPrimitive.Popup>
          </PopoverPrimitive.Positioner>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </>
  );
}
