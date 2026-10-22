import { Button } from "@/components/ui/button";
import { DitherField } from "@/components/ui/DitherField";
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
          <div className="mb-5 flex overflow-hidden rounded-full ring-1 ring-rm-border shadow-md">
            {dmRecipient?.avatar_url ? (
              <AvatarImage
                src={getAuthAssetUrl(dmRecipient.avatar_url)}
                alt=""
                display={dmRecipient.avatar_display}
                className="h-20 w-20"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center bg-rm-accent text-ui-2xl font-semibold text-primary-foreground">
                {channelName?.[0]?.toUpperCase() ?? "?"}
              </div>
            )}
          </div>
          <h1 className="mb-0 font-display text-display text-rm-text-primary text-balance">
            <InlineEmojiText
              text={
                dmRecipient?.display_name ??
                dmRecipient?.username ??
                channelName
              }
            />
          </h1>
          <h2 className="mb-3 text-ui-md font-medium text-rm-text-muted">
            @{dmRecipient?.username ?? channelName.toLowerCase()}
          </h2>
          <p className="max-w-[60ch] text-ui-base text-rm-text-muted text-pretty">
            This is the absolute beginning of your direct message history with{" "}
            <span className="font-semibold text-rm-text-secondary">
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
          <div className="mt-5 flex gap-2">
            <Button type="button" variant="secondary">
              View Profile
            </Button>
            <Button type="button" variant="destructive">
              Block User
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="relative mb-5 flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-xl border border-rm-border shadow-sm">
            <DitherField cell={4} intensity={0.6} seed={11} />
            <Icon
              name="textChannel"
              size="2xl"
              className="relative z-10 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]"
            />
          </div>
          <h3 className="mb-2 font-display text-display text-rm-text-primary text-balance">
            <InlineEmojiText text={`Welcome to #${channelName}`} />
          </h3>
          <p className="max-w-[60ch] text-ui-base text-rm-text-muted text-pretty">
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
