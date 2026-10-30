import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import { PRESS } from "@/components/ui/interaction";
import { useChatStore } from "@/stores/chat-store";
import { formatAppTitle, getAppTitleBarModel } from "./AppTitleBarModel";
import { useShallow } from "zustand/shallow";
import InlineEmojiText from "./InlineEmojiText";

/**
 * Where you are, in one quiet line: "#general · Ralph HQ", "@ada · Direct
 * messages", "Friends". 12/500 ink-3, no glyph: the server header below
 * already carries the identity, so the bar only adds the channel.
 */
export function AppTitleBarContent({ className }: { className?: string }) {
  const model = useChatStore(
    useShallow((state) => {
      const activeServer =
        state.servers.find((server) => server.id === state.activeServerId) ??
        null;
      const activeChannel =
        state.activeServerId && state.activeServerId !== "@me"
          ? (state.channels.find((c) => c.id === state.activeChannelId) ?? null)
          : null;
      const dm =
        state.activeServerId === "@me" && state.activeChannelId
          ? state.dmChannels.find((c) => c.id === state.activeChannelId)
          : undefined;
      return getAppTitleBarModel({
        activeServerId: state.activeServerId,
        activeChannelId: state.activeChannelId,
        activeServer,
        dmHomeView: state.dmHomeView,
        activeChannel,
        dmUsername: dm?.recipient?.username ?? null,
      });
    }),
  );
  const title = formatAppTitle(model);

  return (
    <div
      className={cn(
        "flex min-w-0 items-center justify-center text-ui-xs font-medium text-ink-3 select-none",
        className,
      )}
      aria-label={title ? `Current location: ${title}` : "Current location"}
    >
      {title && <InlineEmojiText text={title} className="truncate" />}
    </div>
  );
}

/** Back / forward: 16px Phosphor carets in 28x24 targets (spec §8 Shell). */
function NavButton({
  direction,
  onClick,
}: {
  direction: "back" | "forward";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={direction === "back" ? "Go back" : "Go forward"}
      onClick={onClick}
      className={cn(
        "flex h-6 w-7 items-center justify-center rounded-sm text-ink-3 outline-none pointer-fine:hover:text-ink-1 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus",
        PRESS,
      )}
    >
      <Icon
        name={direction === "back" ? "chevronLeft" : "chevronRight"}
        size="sm"
      />
    </button>
  );
}

/** The web title bar: one 32px bar on the canvas ply, a seam below. */
export function WebAppTitleBar() {
  return (
    <header
      className="hidden h-8 w-full shrink-0 flex-row items-center border-b border-line bg-ply-0 px-2 md:flex"
      aria-label="Application title bar"
    >
      <div className="flex w-16 items-center gap-0.5">
        <NavButton direction="back" onClick={() => window.history.back()} />
        <NavButton
          direction="forward"
          onClick={() => window.history.forward()}
        />
      </div>
      <AppTitleBarContent className="flex-1" />
      <div className="w-16" aria-hidden="true" />
    </header>
  );
}
