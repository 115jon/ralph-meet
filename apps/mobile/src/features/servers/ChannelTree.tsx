import { CaretDown, CaretRight } from "phosphor-react-native";
import { memo, useCallback, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { useTheme } from "@/theme";
import { Icon, Skeleton, Text } from "@/ui";

import { TextChannelRow, VoiceChannelRow } from "./ChannelRow";
import type { Category, Channel } from "./schema";
import { useServersStore } from "./store";
import { buildBranches, channelKind, type Branch } from "./tree";

interface ChannelTreeProps {
  categories: readonly Category[];
  channels: readonly Channel[];
  onOpenChannel: (channel: Channel) => void;
}

/** Branches of channels under silkscreen labels; a label folds its branch. */
export function ChannelTree({
  categories,
  channels,
  onOpenChannel,
}: ChannelTreeProps) {
  const branches = useMemo(
    () => buildBranches(categories, channels),
    [categories, channels],
  );
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const toggle = useCallback((id: string) => {
    setFolded((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  return (
    <View style={{ paddingHorizontal: 8 }}>
      {branches.map((branch) => (
        <BranchView
          key={branch.id}
          branch={branch}
          folded={folded.has(branch.id)}
          onToggle={toggle}
          onOpenChannel={onOpenChannel}
        />
      ))}
    </View>
  );
}

interface BranchViewProps {
  branch: Branch;
  folded: boolean;
  onToggle: (id: string) => void;
  onOpenChannel: (channel: Channel) => void;
}

const BranchView = memo(function BranchView({
  branch,
  folded,
  onToggle,
  onOpenChannel,
}: BranchViewProps) {
  return (
    <View style={{ marginTop: branch.label ? 10 : 4 }}>
      {branch.label ? (
        <BranchLabel
          branch={branch}
          folded={folded}
          onToggle={() => onToggle(branch.id)}
        />
      ) : null}
      {folded
        ? null
        : branch.channels.map((channel, index) => {
            const Row =
              channelKind(channel) === "voice"
                ? VoiceChannelRow
                : TextChannelRow;
            return (
              <Row
                key={channel.id}
                channel={channel}
                last={index === branch.channels.length - 1}
                onPress={onOpenChannel}
              />
            );
          })}
    </View>
  );
});

interface BranchLabelProps {
  branch: Branch;
  folded: boolean;
  onToggle: () => void;
}

function BranchLabel({ branch, folded, onToggle }: BranchLabelProps) {
  const theme = useTheme();
  const live = useLiveCount(branch.channels);
  const count = live > 0 ? `${live} live` : String(branch.channels.length);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${branch.label ?? ""}, ${count}`}
      accessibilityState={{ expanded: !folded }}
      onPress={onToggle}
      style={({ pressed }) => ({
        height: 32,
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 8,
        backgroundColor: pressed ? theme.tint1 : "transparent",
      })}
    >
      <Icon
        icon={folded ? CaretRight : CaretDown}
        size={12}
        color={theme.ink3}
      />
      <Text variant="silk" tone="ink3" numberOfLines={1} style={{ flex: 1 }}>
        {branch.label}
      </Text>
      <Text variant="num" tone="ink3" style={{ fontSize: 11 }}>
        {count}
      </Text>
    </Pressable>
  );
}

/** Voice channels in the branch with someone in them. */
function useLiveCount(channels: readonly Channel[]): number {
  return useServersStore((s) =>
    channels.reduce(
      (live, channel) =>
        (s.voice[channel.id]?.length ?? 0) > 0 ? live + 1 : live,
      0,
    ),
  );
}

/** Still placeholder rows in the tree's shape while it loads. */
export function ChannelTreeSkeleton() {
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 14, gap: 18 }}>
      {[0, 1].map((branch) => (
        <View key={branch} style={{ gap: 18 }}>
          <Skeleton width={72} height={10} />
          {[0, 1, 2].map((row) => (
            <View
              key={row}
              style={{ flexDirection: "row", gap: 12, paddingLeft: 20 }}
            >
              <Skeleton width={18} height={18} />
              <Skeleton width={`${60 - row * 12}%`} height={18} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
