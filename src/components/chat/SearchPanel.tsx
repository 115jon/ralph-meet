
import { useUserResolution } from "@/hooks/useUserResolution";
import { apiGet } from "@/lib/api-client";
import { useCallback, useEffect, useId, useReducer, useRef } from "react";
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
  | { type: 'SET_QUERY'; payload: string }
  | { type: 'START_SEARCH' }
  | { type: 'SEARCH_SUCCESS'; payload: { results: SearchResult[]; total: number } }
  | { type: 'SEARCH_ERROR' }
  | { type: 'CLEAR_RESULTS' };

function searchReducer(state: SearchState, action: SearchAction): SearchState {
  switch (action.type) {
    case 'SET_QUERY': return { ...state, query: action.payload };
    case 'START_SEARCH': return { ...state, loading: true, searched: true };
    case 'SEARCH_SUCCESS': return { ...state, loading: false, results: action.payload.results, total: action.payload.total };
    case 'SEARCH_ERROR': return { ...state, loading: false };
    case 'CLEAR_RESULTS': return { ...state, results: [], total: 0, searched: false, loading: false };
    default: return state;
  }
}

export default function SearchPanel({ serverId, onClose, onNavigate, onJump }: Props) {
  const [state, dispatch] = useReducer(searchReducer, {
    query: "",
    results: [],
    total: 0,
    loading: false,
    searched: false
  });
  const { query, results, total, loading, searched } = state;

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const dialogTitleId = useId();
  const searchInputId = useId();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey, { capture: true });
    return () => document.removeEventListener("keydown", handleKey, { capture: true });
  }, [onClose]);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      dispatch({ type: 'CLEAR_RESULTS' });
      return;
    }
    dispatch({ type: 'START_SEARCH' });
    try {
      const data = await apiGet<{ messages: SearchResult[]; total: number; }>(`/api/servers/${serverId}/search?q=${encodeURIComponent(q)}&limit=25`);
      dispatch({ type: 'SEARCH_SUCCESS', payload: { results: data.messages, total: data.total } });
    } catch {
      dispatch({ type: 'SEARCH_ERROR' });
    }
  }, [serverId]);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    dispatch({ type: 'SET_QUERY', payload: val });
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val.trim()), 300);
  }, [doSearch]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      doSearch(query.trim());
    }
  }, [query, doSearch]);

  const highlightMatch = (text: string, q: string) => {
    if (!q) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text;
    const start = Math.max(0, idx - 40);
    const end = Math.min(text.length, idx + q.length + 40);
    const snippet = (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
    const matchStart = idx - start + (start > 0 ? 1 : 0);
    return (
      <>
        {snippet.slice(0, matchStart)}
        <mark className="rounded-sm bg-primary/20 px-0.5 text-rm-text font-bold underline decoration-primary/50 underline-offset-2">{snippet.slice(matchStart, matchStart + q.length)}</mark>
        {snippet.slice(matchStart + q.length)}
      </>
    );
  };

  return (
    <div className="fixed inset-0 z-200 flex items-start justify-center pt-[20%]">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
        onClick={onClose}
        aria-label="Close search panel"
      />
      <section
        className="relative flex w-full max-w-[540px] mx-4 animate-in fade-in zoom-in-95 flex-col overflow-hidden rounded-lg border border-rm-border bg-rm-bg-surface shadow-2xl duration-200"
        aria-labelledby={dialogTitleId}
      >
        <h2 id={dialogTitleId} className="sr-only">
          Search messages
        </h2>
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-rm-border px-4 py-3 bg-transparent">
          <label htmlFor={searchInputId} className="sr-only">
            Search messages
          </label>
          <Search className="h-4 w-4 shrink-0 text-rm-text-muted" />
          <input
            ref={inputRef}
            id={searchInputId}
            type="text"
            className="flex-1 bg-transparent text-[15px] font-medium text-rm-text outline-none placeholder:text-rm-text-muted"
            placeholder="Search messages…"
            value={query}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
          />
          <button
            type="button"
            className="cursor-pointer rounded-lg p-1 text-rm-text-muted transition-colors hover:text-rm-text outline-none"
            onClick={onClose}
            aria-label="Close search panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-96 overflow-y-auto custom-scrollbar">
          <div className="p-3">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-6 text-primary/60">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-[11px] font-black uppercase tracking-widest text-primary">Searching...</span>
              </div>
            )}
            {!loading && searched && results.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Search className="h-6 w-6 text-rm-text-muted/40" />
                <span className="text-xs text-rm-text-muted font-bold">No results found</span>
                <span className="text-[11px] text-rm-text-muted/40">Try a different search term</span>
              </div>
            )}
            {!loading && !searched && (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <Search className="h-6 w-6 text-rm-text-muted/40" />
                <span className="text-xs text-rm-text-muted font-bold">Search for messages</span>
                <span className="text-[11px] text-rm-text-muted/40">Type at least 2 characters to search</span>
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
      </section>
    </div>
  );
}

const SearchResultItem = ({ msg, query, onJump, onNavigate, onClose, highlightMatch }: {
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
        <span className="font-bold text-rm-text-muted">{authorInfo.displayName}</span>
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
