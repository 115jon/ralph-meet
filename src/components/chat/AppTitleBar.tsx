import { getAuthAssetUrl } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { ShoppingBag } from "lucide-react";
import { useChatStore } from "@/stores/chat-store";
import { getAppTitleBarModel } from "./AppTitleBarModel";
import { HomeIcon } from "./HomeIcon";
import { Users } from "./Icons";
import { useShallow } from "zustand/shallow";

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
        "flex min-w-0 items-center justify-center gap-1.5 text-[12px] font-bold tracking-wider text-rm-text-muted select-none",
        className,
      )}
      aria-label={
        model.label ? `Current location: ${model.label}` : "Current location"
      }
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full bg-rm-bg-elevated text-[9px] font-bold text-rm-text">
        {model.kind === "server" && model.iconUrl ? (
          <img
            src={getAuthAssetUrl(model.iconUrl)}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : model.kind === "friends" ? (
          <Users className="h-3.5 w-3.5" aria-hidden="true" />
        ) : model.kind === "shop" ? (
          <ShoppingBag className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <HomeIcon className="h-4 w-4" />
        )}
      </span>
      {model.label && <span className="truncate">{model.label}</span>}
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
          className="flex h-6 w-6 items-center justify-center rounded-sm border-0 bg-transparent text-rm-text-muted transition-colors hover:bg-rm-bg-hover hover:text-rm-text"
          aria-label="Go back"
        >
          <span aria-hidden="true">&#8249;</span>
        </button>
        <button
          type="button"
          onClick={() => window.history.forward()}
          className="flex h-6 w-6 items-center justify-center rounded-sm border-0 bg-transparent text-rm-text-muted transition-colors hover:bg-rm-bg-hover hover:text-rm-text"
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
