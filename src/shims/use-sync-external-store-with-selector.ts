// ESM shim — useSyncExternalStoreWithSelector for React 19 + Cloudflare workerd.
// Ported from React upstream: packages/use-sync-external-store/src/useSyncExternalStoreWithSelector.js
// Copyright (c) Meta Platforms, Inc. — MIT License.
//
// The npm `use-sync-external-store` package has CJS/ESM interop issues in
// Cloudflare's workerd runtime, so we re-implement the selector variant here
// using React 19's built-in useSyncExternalStore.
import {
  useDebugValue,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

type Inst<Selection> =
  | { hasValue: true; value: Selection }
  | { hasValue: false; value: null };

export function useSyncExternalStoreWithSelector<Snapshot, Selection>(
  subscribe: (onStoreChange: () => void) => () => void,
  getSnapshot: () => Snapshot,
  getServerSnapshot: (() => Snapshot) | undefined,
  selector: (snapshot: Snapshot) => Selection,
  isEqual?: (a: Selection, b: Selection) => boolean,
): Selection {
  const instRef = useRef<Inst<Selection> | null>(null);
  let inst: Inst<Selection>;
  if (instRef.current === null) {
    inst = { hasValue: false, value: null };
    instRef.current = inst;
  } else {
    inst = instRef.current;
  }

  const [getSelection, getServerSelection] = useMemo(() => {
    let hasMemo = false;
    let memoizedSnapshot: Snapshot;
    let memoizedSelection: Selection;

    const memoizedSelector = (nextSnapshot: Snapshot): Selection => {
      if (!hasMemo) {
        hasMemo = true;
        memoizedSnapshot = nextSnapshot;
        const nextSelection = selector(nextSnapshot);
        if (isEqual !== undefined) {
          if (inst.hasValue) {
            const currentSelection = inst.value;
            if (isEqual(currentSelection as Selection, nextSelection)) {
              memoizedSelection = currentSelection as Selection;
              return currentSelection as Selection;
            }
          }
        }
        memoizedSelection = nextSelection;
        return nextSelection;
      }

      const prevSnapshot = memoizedSnapshot;
      const prevSelection = memoizedSelection;

      if (Object.is(prevSnapshot, nextSnapshot)) {
        return prevSelection;
      }

      const nextSelection = selector(nextSnapshot);
      if (isEqual !== undefined && isEqual(prevSelection, nextSelection)) {
        memoizedSnapshot = nextSnapshot;
        return prevSelection;
      }

      memoizedSnapshot = nextSnapshot;
      memoizedSelection = nextSelection;
      return nextSelection;
    };

    const maybeGetServerSnapshot =
      getServerSnapshot === undefined ? null : getServerSnapshot;
    const getSnapshotWithSelector = () => memoizedSelector(getSnapshot());
    const getServerSnapshotWithSelector =
      maybeGetServerSnapshot === null
        ? undefined
        : () => memoizedSelector(maybeGetServerSnapshot());
    return [getSnapshotWithSelector, getServerSnapshotWithSelector] as const;
  }, [getSnapshot, getServerSnapshot, selector, isEqual]);

  const value = useSyncExternalStore(
    subscribe,
    getSelection,
    getServerSelection,
  );

  useEffect(() => {
    (inst as { hasValue: boolean; value: Selection }).hasValue = true;
    (inst as { hasValue: boolean; value: Selection }).value = value;
  }, [value]);

  useDebugValue(value);
  return value;
}
