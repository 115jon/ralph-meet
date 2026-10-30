import { getAuthAssetUrl } from "@/lib/platform";
import { useChatStore } from "@/stores/chat-store";
import { memo, useMemo } from "react";
import { AvatarImage } from "./AvatarImage";
import { avatarShape } from "@/components/ui/avatar-shape";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import InlineEmojiText from "./InlineEmojiText";

export const ChatWelcomeContent = memo(function ChatWelcomeContent({
  isDM,
  channelName,
  channelId,
}: {
  isDM: boolean;
  channelName: string;
  channelId: string | null;
}) {
  const dmChannels = useChatStore((s) => s.dmChannels);

  const dmRecipient = useMemo(() => {
    if (!isDM || !channelId) return null;
    return dmChannels.find((c: any) => c.id === channelId)?.recipient ?? null;
  }, [isDM, channelId, dmChannels]);

  if (!channelId) return null;

  const dmName =
    dmRecipient?.display_name ?? dmRecipient?.username ?? channelName;

  // The start of a conversation: one glyph or avatar, the name at 18/600 and
  // one plain line. No pep talk; the seam below hands over to the messages.
  return (
    <div className="flex flex-col items-start gap-1 px-4 pt-2 text-left">
      {isDM ? (
        <>
          <div
            className={cn(
              "mb-2 flex size-14",
              avatarShape(
                dmRecipient?.avatar_url && dmRecipient.avatar_display,
              ),
            )}
          >
            {dmRecipient?.avatar_url ? (
              <AvatarImage
                src={getAuthAssetUrl(dmRecipient.avatar_url)}
                alt=""
                display={dmRecipient.avatar_display}
                className="size-14"
              />
            ) : (
              <div className="flex size-full items-center justify-center bg-tint-3 font-display text-ui-xl font-extrabold text-ink-1">
                {channelName?.[0]?.toUpperCase() ?? "?"}
              </div>
            )}
          </div>
          <h1 className="font-display-tuned text-ui-lg font-extrabold tracking-[-0.01em] text-balance text-ink-1">
            <InlineEmojiText text={dmName} />
          </h1>
          <p className="text-ui-sm text-ink-3">
            @{dmRecipient?.username ?? channelName.toLowerCase()}
          </p>
          <p className="mt-2 max-w-[72ch] text-ui-sm text-pretty text-ink-2">
            This is the start of your conversation with{" "}
            <InlineEmojiText text={dmName} />.
          </p>
        </>
      ) : (
        <>
          <div className="mb-2 flex size-10 items-center justify-center rounded-lg bg-tint-1 text-ink-2">
            <Icon name="textChannel" size="lg" />
          </div>
          <h3 className="font-display-tuned text-ui-lg font-extrabold tracking-[-0.01em] text-balance text-ink-1">
            <InlineEmojiText text={`#${channelName}`} />
          </h3>
          <p className="max-w-[72ch] text-ui-sm text-pretty text-ink-2">
            <InlineEmojiText text={`This is the start of #${channelName}.`} />
          </p>
        </>
      )}
      <div aria-hidden className="mt-5 h-px w-full bg-line" />
    </div>
  );
});
