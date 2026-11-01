import { create } from "zustand";

import { selectServer } from "@/features/servers/actions";

/** What fills the home screen beside the rail. */
export type HomePane = "dms" | "server";

const usePaneStore = create<{ pane: HomePane }>()(() => ({ pane: "server" }));

export function useHomePane(): HomePane {
  return usePaneStore((s) => s.pane);
}

export function showDms(): void {
  usePaneStore.setState({ pane: "dms" });
}

export function showServer(serverId: string): void {
  usePaneStore.setState({ pane: "server" });
  selectServer(serverId);
}
