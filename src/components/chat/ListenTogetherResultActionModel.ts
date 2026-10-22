import type {
  ListenTogetherSearchResult,
  ListenTogetherSearchTrackResult,
} from "@/lib/listen-together";
import { Icon, type IconName } from "@/components/ui/icon";
import { createElement } from "react";
import type { ContextMenuItem } from "./ContextMenu";

export type ListenTogetherResultActionId =
  | "play-now"
  | "play-next"
  | "append"
  | "queue-collection"
  | "open-source"
  | "copy-url";

export interface ListenTogetherResultAction {
  id: ListenTogetherResultActionId;
  label: string;
  icon: IconName;
}

export function getListenTogetherResultActions(
  result: ListenTogetherSearchResult,
): ListenTogetherResultAction[] {
  if (result.kind === "track") {
    return [
      { id: "play-now", label: "Play now", icon: "play" },
      { id: "play-next", label: "Play next", icon: "skip" },
      { id: "append", label: "Add to queue", icon: "queueAdd" },
      { id: "open-source", label: "Open source URL", icon: "externalLink" },
      { id: "copy-url", label: "Copy URL", icon: "copy" },
    ];
  }

  return [
    {
      id: "queue-collection",
      label: "Add collection to queue",
      icon: "queueAdd",
    },
    { id: "open-source", label: "Open source URL", icon: "externalLink" },
    { id: "copy-url", label: "Copy URL", icon: "copy" },
  ];
}

export function getListenTogetherResultUrl(
  result: ListenTogetherSearchResult | ListenTogetherSearchTrackResult,
) {
  return result.kind === "track"
    ? result.sourceUrl || result.canonicalUrl
    : result.sourceUrl;
}

export function getListenTogetherContextMenuItems(
  actions: ListenTogetherResultAction[],
  onAction: (action: ListenTogetherResultActionId) => void,
): ContextMenuItem[] {
  return actions.map((action) => ({
    key: action.id,
    label: action.label,
    icon: createElement(Icon, { name: action.icon, size: "sm" }),
    onClick: () => onAction(action.id),
  }));
}
