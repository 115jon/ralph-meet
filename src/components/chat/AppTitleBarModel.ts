import type { Server } from "@/lib/types";

export type DmHomeView = "friends" | "shop";

export type AppTitleBarModel = {
  kind: "friends" | "shop" | "dm" | "server" | "logo";
  label: string;
  iconUrl: string | null;
};

type AppTitleBarModelInput = {
  activeServerId: string | null;
  activeChannelId: string | null;
  activeServer: Pick<Server, "name" | "icon_url"> | null;
  dmHomeView: DmHomeView;
};

export function getAppTitleBarModel({
  activeServerId,
  activeChannelId,
  activeServer,
  dmHomeView,
}: AppTitleBarModelInput): AppTitleBarModel {
  if (activeServerId && activeServerId !== "@me" && activeServer) {
    return {
      kind: "server",
      label: activeServer.name,
      iconUrl: activeServer.icon_url ?? null,
    };
  }

  if (activeServerId === "@me" && activeChannelId) {
    return { kind: "dm", label: "Direct Messages", iconUrl: null };
  }

  if (activeServerId === "@me" && dmHomeView === "shop") {
    return { kind: "shop", label: "Shop", iconUrl: null };
  }

  if (activeServerId === "@me") {
    return { kind: "friends", label: "Friends", iconUrl: null };
  }

  return { kind: "logo", label: "", iconUrl: null };
}
