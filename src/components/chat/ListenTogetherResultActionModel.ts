import type {
  ListenTogetherSearchResult,
  ListenTogetherSearchTrackResult,
} from "@/lib/listen-together";
import { Copy, ExternalLink, ListPlus, Play, SkipForward } from "lucide-react";
import { createElement, type ComponentType } from "react";
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
  icon: ComponentType<{ className?: string }>;
}

export function getListenTogetherResultActions(
  result: ListenTogetherSearchResult,
): ListenTogetherResultAction[] {
  if (result.kind === "track") {
    return [
      { id: "play-now", label: "Play now", icon: Play },
      { id: "play-next", label: "Play next", icon: SkipForward },
      { id: "append", label: "Add to queue", icon: ListPlus },
      { id: "open-source", label: "Open source URL", icon: ExternalLink },
      { id: "copy-url", label: "Copy URL", icon: Copy },
    ];
  }

  return [
    {
      id: "queue-collection",
      label: "Add collection to queue",
      icon: ListPlus,
    },
    { id: "open-source", label: "Open source URL", icon: ExternalLink },
    { id: "copy-url", label: "Copy URL", icon: Copy },
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
    icon: createElement(action.icon, { className: "h-4 w-4" }),
    onClick: () => onAction(action.id),
  }));
}
