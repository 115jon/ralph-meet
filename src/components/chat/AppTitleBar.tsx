import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { useChatStore } from "@/stores/chat-store";
import { getAppTitleBarModel } from "./AppTitleBarModel";
import { HomeIcon } from "./HomeIcon";
import { useShallow } from "zustand/shallow";
import InlineEmojiText from "./InlineEmojiText";

export function AppTitleBarContent({ className }: { className?: string }) {
  const { servers, activeServerId, activeChannelId, dmHomeView } = useChatStore(
    useShallow((state) => ({
      servers: state.servers,
      activeServerId: state.activeServerId,
      activeChannelId: state.activeChannelId,
      dmHomeView: state.dmHomeView,
    })),
  );
  const activeServer =
    servers.find((server) => server.id === activeServerId) ?? null;
  const model = getAppTitleBarModel({
    activeServerId,
    activeChannelId,
    activeServer,
    dmHomeView,
  });

  return (
    <div
      className={cn(
        "flex min-w-0 items-center justify-center gap-1.5 text-ui-xs font-semibold tracking-wider text-rm-text-muted select-none",
        className,
      )}
      aria-label={
        model.label ? `Current location: ${model.label}` : "Current location"
      }
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-rm-bg-elevated text-ui-2xs font-bold text-rm-text">
        {model.kind === "server" && model.iconUrl ? (
          <img
            src={getAuthAssetUrl(model.iconUrl)}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : model.kind === "friends" ? (
          <Icon name="members" size="sm" />
        ) : model.kind === "shop" ? (
          <Icon name="shop" size="sm" />
        ) : (
          <HomeIcon className="h-4 w-4" />
        )}
      </span>
      {model.label && (
        <InlineEmojiText text={model.label} className="truncate" />
      )}
    </div>
  );
}

export function WebAppTitleBar() {
  return (
    <header
      className="hidden h-[24px] w-full shrink-0 flex-row items-center justify-between border-b border-rm-border/30 bg-rm-bg-secondary px-2 md:flex"
      aria-label="Application title bar"
    >
      <div className="ml-1 flex items-center gap-2">
        <button
          type="button"
          onClick={() => window.history.back()}
          className="flex h-6 w-6 items-center justify-center rounded-sm border-0 bg-transparent text-rm-text-muted transition-colors pointer-fine:hover:bg-rm-bg-hover pointer-fine:hover:text-rm-text"
          aria-label="Go back"
        >
          <span aria-hidden="true">&#8249;</span>
        </button>
        <button
          type="button"
          onClick={() => window.history.forward()}
          className="flex h-6 w-6 items-center justify-center rounded-sm border-0 bg-transparent text-rm-text-muted transition-colors pointer-fine:hover:bg-rm-bg-hover pointer-fine:hover:text-rm-text"
          aria-label="Go forward"
        >
          <span aria-hidden="true">&#8250;</span>
        </button>
      </div>
      <AppTitleBarContent className="flex-1" />
      <div className="w-12" aria-hidden="true" />
    </header>
  );
}
