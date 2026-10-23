import { useCallback, useState } from "react";

/**
 * State for a workbench whose phone layout starts on the list. `go(id)`
 * selects a page and pushes into it on phones.
 */
export function useWorkbenchNav<T extends string>(initial: T) {
  // Kept tiny on purpose; callers own anything richer (Studio's search).
  const [state, setState] = useState<{ active: T; showList: boolean }>({
    active: initial,
    showList: true,
  });
  const go = useCallback(
    (id: T) => setState({ active: id, showList: false }),
    [setState],
  );
  const setShowList = useCallback(
    (showList: boolean) => setState((prev) => ({ ...prev, showList })),
    [setState],
  );
  const reset = useCallback(
    (active: T = initial, showList = true) => setState({ active, showList }),
    [initial, setState],
  );
  return {
    active: state.active,
    showList: state.showList,
    go,
    setShowList,
    reset,
  };
}
