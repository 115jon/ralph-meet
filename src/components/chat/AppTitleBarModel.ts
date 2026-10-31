import type { Channel, Server } from "@/lib/types";

type DmHomeView = "friends" | "shop";

export type AppTitleBarModel = {
  kind: "friends" | "shop" | "dm" | "server" | "logo";
  /** Where you are at the top level: the server, Direct messages, Friends. */
  label: string;
  /** The place inside it, when there is one: "#general", "Lounge", "@ada". */
  detail: string;
  iconUrl: string | null;
};

type AppTitleBarModelInput = {
  activeServerId: string | null;
  activeChannelId: string | null;
  activeServer: Pick<Server, "name" | "icon_url"> | null;
  dmHomeView: DmHomeView;
  /** The open server channel, if loaded. */
  activeChannel?: Pick<Channel, "name" | "channel_type"> | null;
  /** The open DM's recipient handle, if loaded. */
  dmUsername?: string | null;
};

export function getAppTitleBarModel({
  activeServerId,
  activeChannelId,
  activeServer,
  dmHomeView,
  activeChannel = null,
  dmUsername = null,
}: AppTitleBarModelInput): AppTitleBarModel {
  if (activeServerId && activeServerId !== "@me" && activeServer) {
    return {
      kind: "server",
      label: activeServer.name,
      detail: activeChannel
        ? activeChannel.channel_type === "voice"
          ? activeChannel.name
          : `#${activeChannel.name}`
        : "",
      iconUrl: activeServer.icon_url ?? null,
    };
  }

  if (activeServerId === "@me" && activeChannelId) {
    return {
      kind: "dm",
      label: "Direct messages",
      detail: dmUsername ? `@${dmUsername}` : "",
      iconUrl: null,
    };
  }

  if (activeServerId === "@me" && dmHomeView === "shop") {
    return { kind: "shop", label: "Shop", detail: "", iconUrl: null };
  }

  if (activeServerId === "@me") {
    return { kind: "friends", label: "Friends", detail: "", iconUrl: null };
  }

  return { kind: "logo", label: "", detail: "", iconUrl: null };
}

/** The title text: "#general · Ralph HQ", or just the label. */
export function formatAppTitle(model: AppTitleBarModel): string {
  return model.detail ? `${model.detail} · ${model.label}` : model.label;
}
