import { useUserResolution } from "@/hooks/useUserResolution";
import { registerBackHandler } from "@/hooks/useBackButton";
import { apiGet } from "@/lib/api-client";
import { useCallback, useEffect, useId, useReducer, useRef } from "react";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Hash, Loader2, Search, X } from "./Icons";

interface SearchResult {
  id: string;
  channel_id: string;
  channel_name: string;
  author_id: string;
  author: {
    id: string;
    username: string;
    avatar_url: string | null;
  };
  content: string;
  is_pinned: boolean;
  created_at: string;
}

interface Props {
  serverId: string;
  onClose: () => void;
  onNavigate?: (channelId: string) => void;
  onJump?: (channelId: string, messageId: string) => void;
}

type SearchState = {
  query: string;
  results: SearchResult[];
  total: number;
  loading: boolean;
  searched: boolean;
};

type SearchAction =
  | { type: "SET_QUERY"; payload: string }
  | { type: "START_SEARCH" }
  | {
      type: "SEARCH_SUCCESS";
      payload: { results: SearchResult[]; total: number };
    }
  | { type: "SEARCH_ERROR" }
  | { type: "CLEAR_RESULTS" };

function searchReducer(state: SearchState, action: SearchAction): SearchState {
  switch (action.type) {
    case "SET_QUERY":
      return {
        ...state,
        query: action.payload,
        results: [],
        total: 0,
        loading: false,
        searched: false,
      };
    case "START_SEARCH":
      return {
        ...state,
        results: [],
        total: 0,
        loading: true,
        searched: true,
      };
    case "SEARCH_SUCCESS":
      return {
        ...state,
        loading: false,
        results: action.payload.results,
        total: action.payload.total,
      };
    case "SEARCH_ERROR":
      return {
        ...state,
        results: [],
        total: 0,
        loading: false,
        searched: true,
      };
    case "CLEAR_RESULTS":
      return {
        ...state,
        results: [],
        total: 0,
        searched: false,
        loading: false,
      };
    default:
      return state;
  }
}

export default function SearchPanel({
  serverId,
  onClose,
  onNavigate,
  onJump,
}: Props) {
  const [state, dispatch] = useReducer(searchReducer, {
    query: "",
    results: [],
    total: 0,
    loading: false,
    searched: false,
  });
  const { query, results, total, loading, searched } = state;

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const requestIdRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const searchInputId = useId();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    return registerBackHandler(() => {
      onClose();
      return true;
    });
  }, [onClose]);

  useEffect(() => {
    requestIdRef.current += 1;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = null;
    controllerRef.current?.abort();
    controllerRef.current = null;
    dispatch({ type: "CLEAR_RESULTS" });
  }, [serverId]);

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      controllerRef.current?.abort();
    };
  }, []);

  const doSearch = useCallback(
    async (q: string, requestId: number) => {
      if (q.length < 2) {
        if (requestId === requestIdRef.current) {
          dispatch({ type: "CLEAR_RESULTS" });
        }
        return;
      }
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      dispatch({ type: "START_SEARCH" });
      try {
        const data = await apiGet<{ messages: SearchResult[]; total: number }>(
          `/api/servers/${serverId}/search?q=${encodeURIComponent(q)}&limit=25`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted || requestId !== requestIdRef.current) {
          return;
        }
        dispatch({
          type: "SEARCH_SUCCESS",
          payload: { results: data.messages, total: data.total },
        });
      } catch {
        if (controller.signal.aborted || requestId !== requestIdRef.current) {
          return;
        }
        dispatch({ type: "SEARCH_ERROR" });
      }
    },
    [serverId],
  );

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      requestIdRef.current += 1;
      controllerRef.current?.abort();
      dispatch({ type: "SET_QUERY", payload: val });
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const requestId = requestIdRef.current;
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void doSearch(val.trim(), requestId);
      }, 300);
    },
    [doSearch],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = null;
        void doSearch(query.trim(), requestIdRef.current);
      }
    },
    [query, doSearch],
  );

  const highlightMatch = (text: string, q: string) => {
    if (!q) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text;
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + q.length + 40);
    const snippet =
      (start > 0 ? "…" : "") +
      text.slice(start, end) +
      (end < text.length ? "…" : "");
    const matchStart = idx - start + (start > 0 ? 1 : 0);
    return (
      <>
        {snippet.slice(0, matchStart)}
        <mark className="rounded-sm bg-primary/20 px-0.5 text-rm-text font-bold underline decoration-primary/50 underline-offset-2">
          {snippet.slice(matchStart, matchStart + q.length)}
        </mark>
        {snippet.slice(matchStart + q.length)}
      </>
    );
  };

  return (
    <Sheet open onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex h-[100dvh] w-full max-w-[540px] flex-col gap-0 border-rm-border bg-rm-bg-surface p-0 max-md:max-w-none"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Search messages</SheetTitle>
          <SheetDescription>Search messages in this server.</SheetDescription>
        </SheetHeader>

        <div className="flex shrink-0 items-center gap-2 border-b border-rm-border bg-transparent px-4 py-3 max-md:pt-[max(12px,var(--safe-area-top,0px))]">
          <label htmlFor={searchInputId} className="sr-only">
            Search messages
          </label>
          <Search className="h-4 w-4 shrink-0 text-rm-text-muted" />
          <input
            ref={inputRef}
            id={searchInputId}
            type="text"
            className="flex-1 bg-transparent text-[15px] font-medium text-rm-text outline-none placeholder:text-rm-text-muted max-md:text-[16px]"
            placeholder="Search messages…"
            value={query}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
          />
          <SheetClose asChild>
            <button
              type="button"
              className="flex size-10 shrink-0 items-center justify-center rounded-lg text-rm-text-muted transition-colors outline-none hover:text-rm-text focus-visible:ring-2 focus-visible:ring-primary/60"
              aria-label="Close search panel"
            >
              <X className="h-4 w-4" />
            </button>
          </SheetClose>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pb-[max(16px,var(--safe-area-bottom,0px))] custom-scrollbar">
          <div className="p-3">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-6 text-primary/60">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-[11px] font-black uppercase tracking-widest text-primary">
                  Searching...
                </span>
              </div>
            )}
            {!loading && searched && results.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Search className="h-6 w-6 text-rm-text-muted/40" />
                <span className="text-xs text-rm-text-muted font-bold">
                  No results found
                </span>
                <span className="text-[11px] text-rm-text-muted/40">
                  Try a different search term
                </span>
              </div>
            )}
            {!loading && !searched && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Search className="h-6 w-6 text-rm-text-muted/40" />
                <span className="text-xs text-rm-text-muted font-bold">
                  Search for messages
                </span>
                <span className="text-[11px] text-rm-text-muted/40">
                  Type at least 2 characters to search
                </span>
              </div>
            )}
            {!loading && results.length > 0 && (
              <>
                <div className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-widest text-rm-text-muted/40">
                  {total} result{total !== 1 ? "s" : ""}
                </div>
                {results.map((msg) => (
                  <SearchResultItem
                    key={msg.id}
                    msg={msg}
                    query={query.trim()}
                    onJump={onJump}
                    onNavigate={onNavigate}
                    onClose={onClose}
                    highlightMatch={highlightMatch}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

const SearchResultItem = ({
  msg,
  query,
  onJump,
  onNavigate,
  onClose,
  highlightMatch,
}: {
  msg: SearchResult;
  query: string;
  onJump?: (channelId: string, messageId: string) => void;
  onNavigate?: (channelId: string) => void;
  onClose: () => void;
  highlightMatch: (text: string, q: string) => React.ReactNode;
}) => {
  const authorInfo = useUserResolution(msg.author_id, msg.author);

  return (
    <button
      type="button"
      className="mb-1 w-full cursor-pointer rounded-xl border-none bg-transparent p-3 text-left transition-all hover:bg-rm-bg-hover group/item outline-none"
      onClick={() => {
        if (onJump) {
          onJump(msg.channel_id, msg.id);
        } else {
          onNavigate?.(msg.channel_id);
        }
        onClose();
      }}
    >
      <div className="mb-1 flex items-center gap-2 text-[11px]">
        <span className="flex items-center gap-0.5 text-primary font-bold">
          <Hash className="h-3 w-3" />
          {msg.channel_name}
        </span>
        <span className="font-bold text-rm-text-muted">
          {authorInfo.displayName}
        </span>
        <span className="ml-auto text-rm-text-muted/60">
          {new Date(msg.created_at).toLocaleDateString()}
        </span>
      </div>
      <div className="text-[13px] leading-relaxed text-rm-text-secondary">
        {highlightMatch(msg.content, query)}
      </div>
    </button>
  );
};
