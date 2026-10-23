import InlineEmojiText from "@/components/chat/InlineEmojiText";
import { MiniAvatar } from "@/components/chat/MiniAvatar";
import { Icon, type IconName } from "@/components/ui/icon";
import { getChannelIcon } from "@/lib/channel-icon";
import { memberLabel } from "@/lib/message-search";
import { cn } from "@/lib/utils";
import type { CSSProperties, ReactNode } from "react";
import { recentSearchLabel } from "./recent-searches";
import {
  FILTER_KEY_META,
  HAS_META,
  type SearchSuggestion,
} from "./search-suggestions";

function GlyphTile({ icon }: { icon: IconName }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-6 shrink-0 items-center justify-center rounded-md bg-rm-tint-1 text-rm-text-muted max-md:size-8"
    >
      <Icon name={icon} size="sm" />
    </span>
  );
}

function Row({
  lead,
  label,
  meta,
  labelStyle,
  labelClassName,
}: {
  lead: ReactNode;
  label: ReactNode;
  meta?: ReactNode;
  labelStyle?: CSSProperties;
  labelClassName?: string;
}) {
  return (
    <>
      {lead}
      <span
        className={cn(
          "min-w-0 truncate text-ui-sm font-medium text-rm-text max-md:text-ui-base",
          labelClassName,
        )}
        style={labelStyle}
      >
        {label}
      </span>
      {meta ? (
        <span className="ml-auto min-w-0 shrink truncate pl-3 text-ui-xs text-rm-text-muted tabular-nums max-md:text-ui-sm">
          {meta}
        </span>
      ) : null}
    </>
  );
}

/** The inside of one suggestion row, shared by the listbox and idle list. */
export function SuggestionContent({
  suggestion,
}: {
  suggestion: SearchSuggestion;
}) {
  switch (suggestion.kind) {
    case "key": {
      const meta = FILTER_KEY_META[suggestion.key];
      return (
        <Row
          lead={<GlyphTile icon={meta.icon} />}
          label={
            <>
              {suggestion.key}:
              <span className="ml-1.5 font-normal text-rm-text-muted">
                {suggestion.hint}
              </span>
            </>
          }
        />
      );
    }
    case "user": {
      const { member } = suggestion;
      const color = member.roleColor ?? undefined;
      return (
        <Row
          lead={
            <MiniAvatar
              avatarUrl={member.avatar_url}
              avatarDisplay={member.avatar_display as string | null}
              displayName={member.display_name}
              username={member.username}
              size={24}
              className="max-md:size-8"
            />
          }
          label={<InlineEmojiText text={memberLabel(member)} />}
          labelClassName={color ? "rm-role-name" : undefined}
          labelStyle={
            color
              ? ({ color, "--rm-role-color": color } as CSSProperties)
              : undefined
          }
          meta={`@${member.username}`}
        />
      );
    }
    case "channel":
      return (
        <Row
          lead={<GlyphTile icon={getChannelIcon(suggestion.channel)} />}
          label={<InlineEmojiText text={suggestion.channel.name} />}
          meta={suggestion.channel.channel_type === "voice" ? "Voice" : null}
        />
      );
    case "has":
      return (
        <Row
          lead={<GlyphTile icon={HAS_META[suggestion.value].icon} />}
          label={suggestion.value}
          meta={HAS_META[suggestion.value].hint}
        />
      );
    case "date":
      return (
        <Row
          lead={<GlyphTile icon="calendar" />}
          label={suggestion.label}
          meta={suggestion.label === suggestion.date ? null : suggestion.date}
        />
      );
    case "pinned":
      return (
        <Row
          lead={<GlyphTile icon="pin" />}
          label={suggestion.value ? "Yes" : "No"}
          meta={suggestion.value ? "Only pinned" : "Exclude pinned"}
        />
      );
    case "recent":
      return (
        <Row
          lead={<GlyphTile icon="clock" />}
          label={recentSearchLabel(suggestion.recent)}
          labelClassName="font-normal text-rm-text-secondary"
        />
      );
  }
}
