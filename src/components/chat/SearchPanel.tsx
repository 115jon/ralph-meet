/**
 * Message search. A docked side panel on desktop (it takes the member list's
 * place) and a full-screen page on phones, never a drawer.
 *
 * The field is a combobox: free text plus filter chips. Typing `from:`,
 * `in:`, `has:`, `mentions:`, `before:`, `after:`, `during:` or `pinned:`
 * opens suggestions (people with their avatars, channels with their glyphs);
 * picking one turns it into a chip that carries an id. Results are grouped
 * by channel and drawn like messages.
 */

import { MiniAvatar } from "@/components/chat/MiniAvatar";
import { Button, Spinner } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { IconButton } from "@/components/ui/IconButton";
import { HIT, PRESS } from "@/components/ui/interaction";
import { MENU_PANEL } from "@/components/ui/menu";
import { registerBackHandler } from "@/hooks/useBackButton";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { getChannelIcon } from "@/lib/channel-icon";
import {
  addFilter,
  commitTypedTokens,
  extractSearchTerms,
  filterId,
  filterValueLabel,
  getAutocompleteContext,
  groupResultsByChannel,
  hasSearchableInput,
  spliceOut,
  type SearchFilter,
  type SearchFilterKey,
  type SearchResultMessage,
  type SearchSort,
} from "@/lib/message-search";
import { getRoleNameColor } from "@/lib/role-color";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/stores/chat-store";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { loadRecentSearches, saveRecentSearch } from "./search/recent-searches";
import {
  buildSearchSuggestions,
  flattenSuggestions,
  suggestionToFilter,
  type RecentSearch,
  type SearchSuggestion,
  type SuggestionChannel,
  type SuggestionGroup,
  type SuggestionMember,
} from "./search/search-suggestions";
import { SearchResultItem } from "./search/SearchResultItem";
import { SuggestionContent } from "./search/SuggestionContent";
import {
  useMessageSearch,
  type SearchFetcher,
  type SearchScope,
} from "./search/useMessageSearch";

export type { SearchScope } from "./search/useMessageSearch";

interface Props {
  scope: SearchScope;
  /** Where the search looks, for the placeholder: a server or DM name. */
  scopeLabel: string;
  onClose: () => void;
  onJump: (channelId: string, messageId: string) => void;
  /** Text to search for on open (the quick switcher hands one over). */
  initialText?: string;
  /** Test and fixture seam; defaults to the API. */
  fetcher?: SearchFetcher;
}

const DEBOUNCE_MS = 350;

const SORT_LABELS: Record<SearchSort, string> = {
  newest: "Newest",
  oldest: "Oldest",
  relevant: "Relevant",
};

const QUICK_FILTERS: Array<{
  key: SearchFilterKey;
  label: string;
  icon: IconName;
}> = [
  { key: "from", label: "From", icon: "account" },
  { key: "mentions", label: "Mentions", icon: "mention" },
  { key: "in", label: "In", icon: "textChannel" },
  { key: "has", label: "Has", icon: "paperclip" },
  { key: "during", label: "Date", icon: "calendar" },
  { key: "pinned", label: "Pinned", icon: "pin" },
];

const EMPTY_MEMBERS: never[] = [];

function useSearchSources(scope: SearchScope) {
  const serverId = scope.kind === "server" ? scope.serverId : null;
  const channelId = scope.kind === "channel" ? scope.channelId : null;
  const serverMembers = useChatStore((s) =>
    serverId ? (s.membersByServerId[serverId] ?? s.members) : EMPTY_MEMBERS,
  );
  const serverChannels = useChatStore((s) =>
    serverId ? s.channelsByServerId[serverId] : undefined,
  );
  const allChannels = useChatStore((s) => s.channels);
  const me = useChatStore((s) => s.user);
  const dmChannels = useChatStore((s) => s.dmChannels);

  const members = useMemo<SuggestionMember[]>(() => {
    if (serverId) {
      return serverMembers.map((m) => ({
        id: m.user.id,
        username: m.user.username,
        display_name: m.user.display_name,
        avatar_url: m.user.avatar_url,
        avatar_display: m.user.avatar_display,
        roleColor: getRoleNameColor(m.roles),
      }));
    }
    const dm = dmChannels.find((c) => c.id === channelId);
    return [me, dm?.recipient]
      .filter((u): u is NonNullable<typeof u> => !!u)
      .map((u) => ({
        id: u.id,
        username: u.username,
        display_name: u.display_name,
        avatar_url: u.avatar_url,
        avatar_display: u.avatar_display,
        roleColor: null,
      }));
  }, [serverId, serverMembers, dmChannels, channelId, me]);

  const channels = useMemo<SuggestionChannel[]>(() => {
    if (!serverId) return [];
    const list =
      serverChannels ?? allChannels.filter((c) => c.server_id === serverId);
    return list
      .filter((c) => c.channel_type === "text" || c.channel_type === "voice")
      .map((c) => ({ id: c.id, name: c.name, channel_type: c.channel_type }));
  }, [serverId, serverChannels, allChannels]);

  const roleColors = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) if (m.roleColor) map.set(m.id, m.roleColor);
    return map;
  }, [members]);

  return { members, channels, roleColors };
}

function FilterChip({
  filter,
  members,
  channels,
  onRemove,
}: {
  filter: SearchFilter;
  members: readonly SuggestionMember[];
  channels: readonly SuggestionChannel[];
  onRemove: () => void;
}) {
  const member =
    filter.key === "from" || filter.key === "mentions"
      ? members.find((m) => m.id === filter.userId)
      : undefined;
  const channel =
    filter.key === "in"
      ? channels.find((c) => c.id === filter.channelId)
      : undefined;
  const value = filterValueLabel(filter);
  return (
    <span className="inline-flex h-7 max-w-full shrink-0 items-center gap-1 rounded-md bg-rm-tint-2 pr-0.5 pl-1.5 text-ui-xs text-rm-text max-md:h-8 max-md:text-ui-sm">
      <span className="text-rm-text-muted">{filter.key}:</span>
      {member && (
        <MiniAvatar
          avatarUrl={member.avatar_url}
          avatarDisplay={member.avatar_display as string | null}
          displayName={member.display_name}
          username={member.username}
          size={16}
        />
      )}
      {channel && (
        <Icon
          name={getChannelIcon(channel)}
          size="xs"
          className="shrink-0 text-rm-text-muted"
        />
      )}
      <span className="min-w-0 truncate font-medium">{value}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove filter ${filter.key}: ${value}`}
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-sm text-rm-text-muted outline-none pointer-fine:hover:text-rm-text",
          PRESS,
          HIT,
        )}
      >
        <Icon name="close" size="xs" />
      </button>
    </span>
  );
}

function SuggestionList({
  groups,
  listboxId,
  activeId,
  onPick,
  onHover,
  floating,
}: {
  groups: readonly SuggestionGroup[];
  listboxId: string;
  activeId: string | null;
  onPick: (s: SearchSuggestion) => void;
  onHover: (id: string) => void;
  floating: boolean;
}) {
  return (
    <div
      id={listboxId}
      role="listbox"
      aria-label="Search suggestions"
      className={cn(
        "overflow-y-auto overscroll-contain",
        floating
          ? cn(
              MENU_PANEL,
              "absolute inset-x-3 top-full z-30 mt-1 max-h-[min(420px,60dvh)] py-1.5",
            )
          : "min-h-0 flex-1 px-2 pt-2 pb-[max(16px,var(--safe-area-bottom,0px))]",
      )}
    >
      {groups.map((group) => {
        const headingId = `${listboxId}-${group.id}`;
        return (
          <div
            key={group.id}
            role="group"
            aria-labelledby={headingId}
            className="not-first:mt-1.5"
          >
            <div
              id={headingId}
              className="px-2 pt-1.5 pb-1 text-ui-xs font-medium text-rm-text-muted"
            >
              {group.heading}
            </div>
            {group.items.map((item) => {
              const optionId = `${listboxId}-${item.id}`;
              const active = activeId === item.id;
              return (
                <div
                  key={item.id}
                  id={optionId}
                  role="option"
                  aria-selected={active}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPick(item)}
                  onPointerMove={() => {
                    if (!active) onHover(item.id);
                  }}
                  className={cn(
                    "flex min-h-8 cursor-pointer items-center gap-2.5 rounded-md px-2 py-1 select-none max-md:min-h-12 max-md:gap-3",
                    active && "bg-rm-tint-2",
                  )}
                >
                  <SuggestionContent suggestion={item} />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function ResultSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2 px-3 pt-2">
      {[0.9, 0.6, 0.75, 0.5, 0.8].map((w, i) => (
        <div
          key={i}
          className="flex gap-3 rounded-lg bg-rm-tint-1 px-3 py-3 motion-safe:animate-pulse"
          style={{ animationDelay: `${i * 90}ms` }}
        >
          <div className="size-9 shrink-0 rounded-full bg-rm-tint-2 max-md:size-10" />
          <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
            <div className="flex gap-2">
              <div className="h-3 w-24 rounded-sm bg-rm-tint-3" />
              <div className="h-3 w-16 rounded-sm bg-rm-tint-2" />
            </div>
            <div
              className="h-3 rounded-sm bg-rm-tint-2"
              style={{ width: `${w * 100}%` }}
            />
            {i % 2 === 0 && (
              <div className="h-3 w-2/5 rounded-sm bg-rm-tint-2" />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function StateMessage({
  icon,
  title,
  body,
  children,
}: {
  icon: IconName;
  title: string;
  body?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-8 pt-14 pb-8 text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-rm-tint-1 text-rm-text-muted">
        <Icon name={icon} size="xl" />
      </span>
      <p className="text-ui-base font-semibold text-rm-text text-balance">
        {title}
      </p>
      {body && (
        <p className="mt-1 max-w-[30ch] text-ui-sm text-rm-text-muted text-pretty">
          {body}
        </p>
      )}
      {children && <div className="mt-4 flex gap-2">{children}</div>}
    </div>
  );
}

/**
 * Keyed by scope: moving to another server or DM starts a fresh search (and
 * drops any request still in flight for the old one).
 */
export default function SearchPanel(props: Props) {
  const key =
    props.scope.kind === "server"
      ? `s:${props.scope.serverId}`
      : `c:${props.scope.channelId}`;
  return <SearchPanelBody key={key} {...props} />;
}

function SearchPanelBody({
  scope,
  scopeLabel,
  onClose,
  onJump,
  initialText = "",
  fetcher,
}: Props) {
  const isMobile = useIsMobile();
  const scopeKey =
    scope.kind === "server" ? `s:${scope.serverId}` : `c:${scope.channelId}`;
  const { members, channels, roleColors } = useSearchSources(scope);
  const search = useMessageSearch(scope, fetcher);
  const { state } = search;

  // Complete tokens in handed-over text (`from:ada token`) open as chips.
  const [initial] = useState(() =>
    commitTypedTokens(initialText, [], {
      members,
      channels,
      now: new Date(),
    }),
  );
  const [text, setText] = useState(initial.text);
  const [caret, setCaret] = useState(initial.text.length);
  const [filters, setFilters] = useState<SearchFilter[]>(initial.filters);
  const [sort, setSort] = useState<SearchSort>("newest");
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeResultId, setActiveResultId] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentSearch[]>(() =>
    loadRecentSearches(scopeKey),
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleId = useId();
  const listboxId = useId();
  const inputId = useId();

  const allowChannelFilter = scope.kind === "server";
  const sourcesForResolve = useMemo(
    () => ({ members, channels, now: new Date() }),
    [members, channels],
  );

  const context = useMemo(
    () => getAutocompleteContext(text, caret),
    [text, caret],
  );
  const groups = useMemo(
    () =>
      buildSearchSuggestions(context, {
        members,
        channels,
        now: new Date(),
        allowChannelFilter,
      }),
    [context, members, channels, allowChannelFilter],
  );
  const flat = useMemo(() => flattenSuggestions(groups), [groups]);
  const idleGroups = useMemo(
    () =>
      buildSearchSuggestions(
        { kind: "key", query: "", start: 0, end: 0 },
        {
          members,
          channels,
          now: new Date(),
          allowChannelFilter,
          recent,
        },
      ),
    [members, channels, allowChannelFilter, recent],
  );

  const suggestionsOpen =
    focused &&
    !dismissed &&
    flat.length > 0 &&
    !(context?.kind === "key" && context.query === "");
  const activeIndex = activeId ? flat.findIndex((s) => s.id === activeId) : -1;

  const terms = useMemo(() => extractSearchTerms(state.text), [state.text]);
  const resultGroups = useMemo(
    () => groupResultsByChannel(state.results),
    [state.results],
  );
  const channelById = useMemo(
    () => new Map(channels.map((c) => [c.id, c])),
    [channels],
  );

  // ── Lifecycle ────────────────────────────────────────────────────────────

  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    inputRef.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(
    () =>
      registerBackHandler(() => {
        onClose();
        return true;
      }),
    [onClose],
  );

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const { run } = search;
  const initialRunRef = useRef(false);
  useEffect(() => {
    if (initialRunRef.current) return;
    initialRunRef.current = true;
    // A half-typed filter (`from:`) waits for a pick instead of searching.
    if (getAutocompleteContext(initial.text)?.kind === "value") return;
    if (!hasSearchableInput(initial.text, initial.filters)) return;
    run(initial.text, initial.filters, "newest");
  }, [initial, run]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0;
  }, [state.generation]);

  const { loadMore } = search;
  const canLoadMore =
    state.status === "success" && state.hasMore && !state.loadMoreFailed;
  useEffect(() => {
    const node = sentinelRef.current;
    const root = listRef.current;
    if (!node || !root || !canLoadMore) return;
    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { root, rootMargin: "0px 0px 320px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [canLoadMore, loadMore]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const cancelDebounce = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
  };

  const runNow = (
    nextText: string,
    nextFilters: readonly SearchFilter[],
    nextSort: SearchSort = sort,
  ) => {
    cancelDebounce();
    setActiveResultId(null);
    run(nextText, nextFilters, nextSort);
  };

  const placeCaret = (position: number) => {
    setCaret(position);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(position, position);
    });
  };

  const defaultActiveFor = (
    nextText: string,
    nextCaret: number,
  ): string | null => {
    const ctx = getAutocompleteContext(nextText, nextCaret);
    if (!ctx || (ctx.kind === "key" && ctx.query === "")) return null;
    const first = flattenSuggestions(
      buildSearchSuggestions(ctx, {
        members,
        channels,
        now: new Date(),
        allowChannelFilter,
      }),
    )[0];
    return first?.id ?? null;
  };

  const updateText = (nextText: string, nextCaret: number) => {
    setText(nextText);
    setCaret(nextCaret);
    setDismissed(false);
    setActiveId(defaultActiveFor(nextText, nextCaret));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const position = e.target.selectionStart ?? value.length;

    // A finished token (`from:ada `) becomes a chip as soon as it is typed.
    if (/\s$/.test(value) && position === value.length) {
      const committed = commitTypedTokens(value, filters, sourcesForResolve);
      if (committed.committed > 0) {
        setFilters(committed.filters);
        updateText(committed.text, committed.text.length);
        runNow(committed.text, committed.filters);
        return;
      }
    }

    updateText(value, position);
    const ctx = getAutocompleteContext(value, position);
    cancelDebounce();
    if (ctx?.kind === "value") return; // still choosing a filter value
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      setActiveResultId(null);
      run(value, filters, sort);
    }, DEBOUNCE_MS);
  };

  const applySuggestion = (suggestion: SearchSuggestion) => {
    if (suggestion.kind === "recent") {
      const { recent: r } = suggestion;
      setFilters(r.filters);
      updateText(r.text, r.text.length);
      setDismissed(true);
      runNow(r.text, r.filters);
      placeCaret(r.text.length);
      return;
    }

    if (suggestion.kind === "key") {
      const insert = `${suggestion.key}:`;
      let nextText: string;
      let position: number;
      if (context && context.kind === "key") {
        nextText = `${text.slice(0, context.start)}${insert}${text.slice(context.end)}`;
        position = context.start + insert.length;
      } else {
        const base = text.trimEnd();
        nextText = base ? `${base} ${insert}` : insert;
        position = nextText.length;
      }
      updateText(nextText, position);
      placeCaret(position);
      return;
    }

    const filter = suggestionToFilter(suggestion);
    if (!filter) return;
    const nextFilters = addFilter(filters, filter);
    const nextText =
      context && context.kind === "value"
        ? spliceOut(text, context.start, context.end)
        : text;
    setFilters(nextFilters);
    updateText(nextText, nextText.length);
    setDismissed(true);
    runNow(nextText, nextFilters);
    placeCaret(nextText.length);
  };

  const insertFilterKey = (key: SearchFilterKey) => {
    applySuggestion({ id: `key:${key}`, kind: "key", key, hint: "" });
  };

  const removeFilter = (id: string) => {
    const nextFilters = filters.filter((f) => filterId(f) !== id);
    setFilters(nextFilters);
    runNow(text, nextFilters);
    inputRef.current?.focus();
  };

  const clearAll = () => {
    setFilters([]);
    updateText("", 0);
    runNow("", []);
    placeCaret(0);
  };

  const submit = () => {
    const committed = commitTypedTokens(text, filters, sourcesForResolve);
    if (committed.committed > 0) {
      setFilters(committed.filters);
      updateText(committed.text, committed.text.length);
    }
    setDismissed(true);
    runNow(committed.text, committed.filters);
    if (isMobile) inputRef.current?.blur();
  };

  const changeSort = (next: SearchSort) => {
    if (next === sort) return;
    setSort(next);
    runNow(text, filters, next);
  };

  const handleJump = useCallback(
    (message: SearchResultMessage) => {
      setActiveResultId(message.id);
      setRecent((current) =>
        saveRecentSearch(scopeKey, current, { text: state.text, filters }),
      );
      onJump(message.channel_id, message.id);
      if (isMobile) onClose();
    },
    [filters, isMobile, onClose, onJump, scopeKey, state.text],
  );

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const input = e.currentTarget;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (suggestionsOpen) {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        const base = activeIndex === -1 ? (delta === 1 ? -1 : 0) : activeIndex;
        const next = (base + delta + flat.length) % flat.length;
        setActiveId(flat[next]!.id);
        return;
      }
      if (e.key === "ArrowDown" && state.results.length > 0) {
        e.preventDefault();
        listRef.current
          ?.querySelector<HTMLButtonElement>("[data-search-result]")
          ?.focus();
      }
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (suggestionsOpen && activeIndex >= 0) {
        applySuggestion(flat[activeIndex]!);
      } else {
        submit();
      }
      return;
    }

    if (e.key === "Tab" && suggestionsOpen && activeIndex >= 0 && !e.shiftKey) {
      e.preventDefault();
      applySuggestion(flat[activeIndex]!);
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (suggestionsOpen) setDismissed(true);
      else onClose();
      return;
    }

    if (
      e.key === "Backspace" &&
      input.selectionStart === 0 &&
      input.selectionEnd === 0 &&
      filters.length > 0
    ) {
      e.preventDefault();
      removeFilter(filterId(filters[filters.length - 1]!));
    }
  };

  const handleResultsKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") {
      if (e.key === "Escape") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      return;
    }
    const items = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-search-result]",
      ) ?? [],
    );
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (index === -1) return;
    e.preventDefault();
    if (e.key === "ArrowUp" && index === 0) {
      inputRef.current?.focus();
      return;
    }
    items[
      Math.min(
        items.length - 1,
        Math.max(0, index + (e.key === "ArrowDown" ? 1 : -1)),
      )
    ]?.focus();
  };

  // ── Render ───────────────────────────────────────────────────────────────

  const announcement =
    state.status === "loading"
      ? "Searching"
      : state.status === "error"
        ? "Search failed"
        : state.status === "success"
          ? state.total === 0
            ? "No results"
            : `${state.total} ${state.total === 1 ? "result" : "results"}`
          : "";

  const activeOptionId =
    suggestionsOpen && activeId ? `${listboxId}-${activeId}` : undefined;
  const hasInput = text.length > 0 || filters.length > 0;
  const placeholder =
    filters.length > 0 ? "Add words or filters" : `Search ${scopeLabel}`;

  const field = (
    <div
      className={cn(
        "relative flex min-w-0 flex-1 flex-wrap items-center gap-1 rounded-lg border border-transparent bg-rm-tint-1 py-1 pr-1 pl-2.5",
        "focus-within:border-rm-focus",
        "max-md:min-h-11 md:min-h-9",
      )}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          inputRef.current?.focus();
        }
      }}
    >
      <Icon
        name="search"
        size="sm"
        className="mr-0.5 shrink-0 text-rm-text-muted"
      />
      {filters.map((filter) => (
        <FilterChip
          key={filterId(filter)}
          filter={filter}
          members={members}
          channels={channels}
          onRemove={() => removeFilter(filterId(filter))}
        />
      ))}
      <label htmlFor={inputId} className="sr-only">
        Search messages in {scopeLabel}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={suggestionsOpen}
        aria-controls={suggestionsOpen ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        aria-describedby={`${inputId}-hint`}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="search"
        value={text}
        placeholder={placeholder}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelect={(e) =>
          setCaret(
            e.currentTarget.selectionStart ?? e.currentTarget.value.length,
          )
        }
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="rm-search-input h-7 min-w-[8ch] flex-1 bg-transparent text-ui-sm text-rm-text outline-none placeholder:text-rm-text-muted max-md:h-8 max-md:text-ui-md"
      />
      <span id={`${inputId}-hint`} className="sr-only">
        Type from:, mentions:, in:, has:, before:, after:, during: or pinned: to
        add a filter.
      </span>
      {hasInput && (
        <button
          type="button"
          onClick={clearAll}
          aria-label="Clear search"
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md text-rm-text-muted outline-none pointer-fine:hover:text-rm-text max-md:size-8",
            PRESS,
            HIT,
          )}
        >
          <Icon name="close" size="sm" />
        </button>
      )}
    </div>
  );

  const toolbar = state.status === "success" && state.total > 0 && (
    <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
      <p className="text-ui-xs font-medium text-rm-text-muted tabular-nums">
        {state.total.toLocaleString()}{" "}
        {state.total === 1 ? "result" : "results"}
      </p>
      <div
        role="group"
        aria-label="Sort results"
        className="flex items-center rounded-md bg-rm-tint-1 p-0.5"
      >
        {(Object.keys(SORT_LABELS) as SearchSort[]).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={sort === key}
            onClick={() => changeSort(key)}
            className={cn(
              "h-6 rounded-sm px-2 text-ui-xs font-medium text-rm-text-muted outline-none pointer-fine:hover:text-rm-text aria-pressed:bg-rm-bg-primary aria-pressed:font-semibold aria-pressed:text-rm-text max-md:h-8 max-md:px-2.5",
              PRESS,
              HIT,
            )}
          >
            {SORT_LABELS[key]}
          </button>
        ))}
      </div>
    </div>
  );

  const idleBody = (
    <div className="px-2 pt-2 pb-6">
      {idleGroups.map((group) => (
        <section key={group.id} className="not-first:mt-4">
          <h3 className="px-2 pt-1.5 pb-1 text-ui-xs font-medium text-rm-text-muted">
            {group.heading}
          </h3>
          <ul>
            {group.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => applySuggestion(item)}
                  className="flex min-h-9 w-full items-center gap-2.5 rounded-md px-2 py-1 text-left outline-none select-none pointer-fine:hover:bg-rm-tint-2 focus-visible:bg-rm-tint-2 active:bg-rm-tint-2 max-md:min-h-12 max-md:gap-3"
                >
                  <SuggestionContent suggestion={item} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );

  let body: React.ReactNode;
  if (state.status === "idle") body = idleBody;
  else if (state.status === "loading") body = <ResultSkeleton />;
  else if (state.status === "error")
    body = (
      <StateMessage
        icon="warning"
        title="Search didn't load"
        body="Check your connection and try again."
      >
        <Button variant="secondary" onClick={search.retry}>
          <Icon name="refresh" size="sm" />
          Try again
        </Button>
      </StateMessage>
    );
  else if (state.results.length === 0)
    body = (
      <StateMessage
        icon="search"
        title="No messages found"
        body={
          filters.length > 0
            ? "Nothing matches every filter. Remove one or try other words."
            : "Try other words, or a filter like from: or has:."
        }
      >
        {filters.length > 0 && (
          <Button variant="secondary" onClick={clearAll}>
            Clear search
          </Button>
        )}
      </StateMessage>
    );
  else
    body = (
      <div className="px-2 pb-6" onKeyDown={handleResultsKeyDown}>
        {resultGroups.map((group) => {
          const channel = channelById.get(group.channelId);
          const name = group.channelName ?? channel?.name ?? "Unknown channel";
          return (
            <section key={group.key} aria-label={`In ${name}`} className="mt-1">
              {scope.kind === "server" && (
                <h3 className="sticky top-0 z-10 flex items-center gap-1.5 bg-rm-bg-primary px-2 pt-2 pb-1.5 text-ui-xs font-semibold text-rm-text-secondary">
                  <Icon
                    name={
                      channel
                        ? getChannelIcon(channel)
                        : ("textChannel" as IconName)
                    }
                    size="xs"
                    className="text-rm-text-muted"
                  />
                  <span className="truncate">{name}</span>
                </h3>
              )}
              <ol className="flex flex-col gap-1.5">
                {group.messages.map((message) => (
                  <li key={message.id}>
                    <SearchResultItem
                      message={message}
                      terms={terms}
                      roleColor={roleColors.get(message.author_id) ?? null}
                      active={activeResultId === message.id}
                      onJump={handleJump}
                    />
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
        <div ref={sentinelRef} aria-hidden="true" className="h-px" />
        <div className="flex justify-center pt-3">
          {state.loadingMore ? (
            <span
              role="status"
              className="inline-flex items-center gap-2 text-ui-xs text-rm-text-muted"
            >
              <Spinner />
              Loading more
            </span>
          ) : state.loadMoreFailed ? (
            <Button variant="secondary" size="sm" onClick={search.retry}>
              Couldn't load more. Retry
            </Button>
          ) : state.hasMore ? (
            <Button variant="ghost" size="sm" onClick={search.loadMore}>
              Load more
            </Button>
          ) : (
            <span className="text-ui-xs text-rm-text-muted">
              End of results
            </span>
          )}
        </div>
      </div>
    );

  const suggestionList = suggestionsOpen && (
    <SuggestionList
      groups={groups}
      listboxId={listboxId}
      activeId={activeId}
      onPick={applySuggestion}
      onHover={setActiveId}
      floating={!isMobile}
    />
  );

  return (
    <section
      role={isMobile ? "dialog" : "complementary"}
      aria-modal={isMobile ? true : undefined}
      aria-labelledby={titleId}
      className={cn(
        "flex min-h-0 flex-col bg-rm-bg-primary",
        "max-md:fixed max-md:inset-0 max-md:z-50",
        "max-md:transition-[opacity,transform] max-md:duration-200 max-md:ease-(--rm-ease-out) max-md:starting:translate-y-2 max-md:starting:opacity-0 motion-reduce:max-md:starting:translate-y-0",
        "md:h-full md:w-[400px] md:shrink-0 md:border-l md:border-rm-border lg:w-[420px]",
      )}
    >
      <h2 id={titleId} className="sr-only">
        Search messages
      </h2>
      <p role="status" className="sr-only">
        {announcement}
      </p>

      <header className="relative z-20 shrink-0 border-b border-rm-border max-md:pt-[var(--safe-area-top,0px)]">
        <div className="flex items-start gap-1 px-3 max-md:min-h-14 max-md:py-1.5 max-md:pl-1 md:min-h-12 md:py-1.5">
          <IconButton
            aria-label="Close search"
            icon="back"
            variant="muted"
            size="md"
            className="mt-0.5 md:hidden"
            onClick={onClose}
          />
          {field}
          <IconButton
            aria-label="Close search"
            icon="close"
            variant="muted"
            size="sm"
            className="mt-0.5 ml-1 max-md:hidden"
            onClick={onClose}
          />
        </div>
        {isMobile && (
          <div
            role="group"
            aria-label="Add a filter"
            className="flex gap-2 overflow-x-auto px-3 pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {QUICK_FILTERS.filter(
              (f) => allowChannelFilter || f.key !== "in",
            ).map((f) => (
              <button
                key={f.key}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertFilterKey(f.key)}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-rm-border-strong px-3 text-ui-sm font-medium text-rm-text-secondary outline-none",
                  PRESS,
                  HIT,
                )}
              >
                <Icon name={f.icon} size="sm" className="text-rm-text-muted" />
                {f.label}
              </button>
            ))}
          </div>
        )}
        {!isMobile && suggestionList}
      </header>

      {isMobile && suggestionList ? (
        suggestionList
      ) : (
        <div
          ref={listRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[var(--safe-area-bottom,0px)] custom-scrollbar"
        >
          {toolbar}
          {body}
        </div>
      )}
    </section>
  );
}
