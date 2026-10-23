import { apiGet } from "@/lib/api-client";
import {
  buildSearchQuery,
  hasSearchableInput,
  toSearchParams,
  type MessageSearchQuery,
  type MessageSearchResponse,
  type SearchFilter,
  type SearchResultMessage,
  type SearchSort,
} from "@/lib/message-search";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
} from "react";

export type SearchScope =
  | { kind: "server"; serverId: string }
  | { kind: "channel"; channelId: string };

export function searchEndpoint(scope: SearchScope): string {
  return scope.kind === "server"
    ? `/api/servers/${encodeURIComponent(scope.serverId)}/search`
    : `/api/channels/${encodeURIComponent(scope.channelId)}/search`;
}

export type SearchStatus = "idle" | "loading" | "success" | "error";

export interface MessageSearchState {
  status: SearchStatus;
  results: SearchResultMessage[];
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  /** The text the current results were fetched for (for highlighting). */
  text: string;
  /** Bumps on every fresh search so the list can scroll back to the top. */
  generation: number;
}

type Action =
  | { type: "reset" }
  | { type: "start"; text: string }
  | { type: "success"; data: MessageSearchResponse }
  | { type: "error" }
  | { type: "more-start" }
  | { type: "more-success"; data: MessageSearchResponse }
  | { type: "more-error" };

const initialState: MessageSearchState = {
  status: "idle",
  results: [],
  total: 0,
  hasMore: false,
  loadingMore: false,
  loadMoreFailed: false,
  text: "",
  generation: 0,
};

function reducer(
  state: MessageSearchState,
  action: Action,
): MessageSearchState {
  switch (action.type) {
    case "reset":
      return { ...initialState, generation: state.generation + 1 };
    case "start":
      return {
        ...state,
        status: "loading",
        results: [],
        total: 0,
        hasMore: false,
        loadingMore: false,
        loadMoreFailed: false,
        text: action.text,
        generation: state.generation + 1,
      };
    case "success":
      return {
        ...state,
        status: "success",
        results: action.data.messages,
        total: action.data.total,
        hasMore: action.data.has_more,
      };
    case "error":
      return { ...state, status: "error", results: [], hasMore: false };
    case "more-start":
      return { ...state, loadingMore: true, loadMoreFailed: false };
    case "more-success": {
      const seen = new Set(state.results.map((m) => m.id));
      return {
        ...state,
        loadingMore: false,
        results: [
          ...state.results,
          ...action.data.messages.filter((m) => !seen.has(m.id)),
        ],
        total: action.data.total,
        hasMore: action.data.has_more,
      };
    }
    case "more-error":
      return { ...state, loadingMore: false, loadMoreFailed: true };
    default:
      return state;
  }
}

export type SearchFetcher = (
  url: string,
  signal: AbortSignal,
) => Promise<MessageSearchResponse>;

const defaultFetcher: SearchFetcher = (url, signal) =>
  apiGet<MessageSearchResponse>(url, { signal });

/**
 * Where search requests go. The API by default; dev fixtures provide seeded
 * results through this so the real panel renders without a session.
 */
export const SearchFetcherContext =
  createContext<SearchFetcher>(defaultFetcher);

/**
 * Runs searches for the panel: one request at a time (a new search aborts the
 * old one), offset pagination for infinite scroll, and a retry that repeats
 * the last request. Everything is driven from event handlers; there is no
 * effect that fetches on state change.
 */
export function useMessageSearch(
  scope: SearchScope,
  fetcherOverride?: SearchFetcher,
) {
  const contextFetcher = useContext(SearchFetcherContext);
  const fetcher = fetcherOverride ?? contextFetcher;
  const [state, dispatch] = useReducer(reducer, initialState);
  const controllerRef = useRef<AbortController | null>(null);
  const lastQueryRef = useRef<MessageSearchQuery | null>(null);
  const endpoint = searchEndpoint(scope);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  const request = useCallback(
    async (query: MessageSearchQuery, append: boolean) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      lastQueryRef.current = query;
      dispatch(
        append ? { type: "more-start" } : { type: "start", text: query.text },
      );
      try {
        const data = await fetcher(
          `${endpoint}?${toSearchParams(query).toString()}`,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        dispatch(
          append ? { type: "more-success", data } : { type: "success", data },
        );
      } catch {
        if (controller.signal.aborted) return;
        dispatch(append ? { type: "more-error" } : { type: "error" });
      }
    },
    [endpoint, fetcher],
  );

  const run = useCallback(
    (text: string, filters: readonly SearchFilter[], sort: SearchSort) => {
      if (!hasSearchableInput(text, filters)) {
        controllerRef.current?.abort();
        lastQueryRef.current = null;
        dispatch({ type: "reset" });
        return;
      }
      void request(buildSearchQuery(text, filters, { sort }), false);
    },
    [request],
  );

  const loadMore = useCallback(() => {
    const last = lastQueryRef.current;
    if (!last || !state.hasMore || state.loadingMore) return;
    void request({ ...last, offset: state.results.length }, true);
  }, [request, state.hasMore, state.loadingMore, state.results.length]);

  const retry = useCallback(() => {
    const last = lastQueryRef.current;
    if (!last) return;
    if (last.offset > 0) void request(last, true);
    else void request(last, false);
  }, [request]);

  return { state, run, loadMore, retry };
}
