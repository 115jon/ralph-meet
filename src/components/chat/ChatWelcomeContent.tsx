import { getAuthAssetUrl } from "@/lib/platform";
import { useChatStore } from "@/stores/chat-store";
import { memo, useMemo } from "react";
import { AvatarImage } from "./AvatarImage";
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

  return (
    <div className="flex flex-col items-start px-4 pt-2 text-left">
      {isDM ? (
        <>
          <div className="mb-4 flex overflow-hidden rounded-full">
            {dmRecipient?.avatar_url ? (
              <AvatarImage
                src={getAuthAssetUrl(dmRecipient.avatar_url)}
                alt=""
                display={dmRecipient.avatar_display}
                className="h-20 w-20"
              />
            ) : (
              <div className="flex size-20 items-center justify-center bg-rm-accent-solid text-ui-2xl font-semibold text-rm-on-accent">
                {channelName?.[0]?.toUpperCase() ?? "?"}
              </div>
            )}
          </div>
          <h1 className="text-ui-xl font-semibold text-balance text-rm-text">
            <InlineEmojiText
              text={
                dmRecipient?.display_name ??
                dmRecipient?.username ??
                channelName
              }
            />
          </h1>
          <h2 className="mb-3 text-ui-md font-medium text-rm-text-secondary">
            @{dmRecipient?.username ?? channelName.toLowerCase()}
          </h2>
          <p className="max-w-[62ch] text-ui-base text-pretty text-rm-text-secondary">
            This is the absolute beginning of your direct message history with{" "}
            <span className="font-semibold text-rm-text">
              <InlineEmojiText
                text={
                  dmRecipient?.display_name ??
                  dmRecipient?.username ??
                  channelName
                }
              />
            </span>
            . Be kind, be bold, and let the conversation flow.
          </p>
        </>
      ) : (
        <>
          <div className="mb-4 flex size-18 items-center justify-center rounded-lg bg-rm-accent-tint text-rm-accent-ink">
            <Icon name="textChannel" size="2xl" />
          </div>
          <h3 className="mb-3 text-ui-xl font-semibold text-balance text-rm-text">
            <InlineEmojiText text={`Welcome to #${channelName}`} />
          </h3>
          <p className="max-w-[62ch] text-ui-base text-pretty text-rm-text-secondary">
            <InlineEmojiText
              text={`This is the absolute beginning of the #${channelName} channel. Start a conversation, forge new paths, and let your frequencies align.`}
            />
          </p>
        </>
      )}
      <div className="mt-6 h-px w-full bg-gradient-to-r from-rm-border to-transparent" />
    </div>
  );
});
