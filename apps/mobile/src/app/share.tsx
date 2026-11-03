import { Image } from "expo-image";
import { router } from "expo-router";
import { File, Hash, VideoCamera } from "phosphor-react-native";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";

import { PickerSearch } from "@/features/chat/picker/PickerSearch";
import { goToConversation } from "@/features/conversation/navigation";
import { loadDms } from "@/features/dms/actions";
import { useDmsStore } from "@/features/dms/store";
import { describePayload, type SharePayload } from "@/features/share/payload";
import {
  setPendingShare,
  stageShare,
  usePendingShare,
} from "@/features/share/store";
import { shareTargets, type ShareTarget } from "@/features/share/targets";
import { useServersStore } from "@/features/servers/store";
import { mediaUrl } from "@/lib/api";
import { RADIUS, useTheme } from "@/theme";
import { Avatar, EmptyState, Header, Icon, Screen, Text } from "@/ui";

const THUMB = 56;
const MAX_THUMBS = 4;

/** What is being sent: up to four thumbnails, then the text. */
function SharePreview({ payload }: { payload: SharePayload }) {
  const theme = useTheme();
  const shown = payload.files.slice(0, MAX_THUMBS);
  const more = payload.files.length - shown.length;
  return (
    <View
      style={{
        marginHorizontal: 16,
        marginTop: 12,
        padding: 12,
        gap: 10,
        borderRadius: RADIUS,
        borderWidth: 1,
        borderColor: theme.line,
        backgroundColor: theme.ply1,
      }}
    >
      <Text variant="silk" tone="ink3">
        {describePayload(payload)}
      </Text>
      {shown.length > 0 ? (
        <View style={{ flexDirection: "row", gap: 6 }}>
          {shown.map((file) => (
            <View
              key={file.key}
              style={{
                width: THUMB,
                height: THUMB,
                borderRadius: RADIUS,
                overflow: "hidden",
                backgroundColor: theme.ply3,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {file.kind === "image" ? (
                <Image
                  source={{ uri: file.uri }}
                  contentFit="cover"
                  accessibilityIgnoresInvertColors
                  style={{ width: THUMB, height: THUMB }}
                />
              ) : (
                <Icon
                  icon={file.kind === "video" ? VideoCamera : File}
                  size={22}
                  color={theme.ink2}
                />
              )}
            </View>
          ))}
          {more > 0 ? (
            <View
              style={{
                width: THUMB,
                height: THUMB,
                borderRadius: RADIUS,
                backgroundColor: theme.tint2,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text variant="num" tone="ink2">
                +{more}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {payload.text ? (
        <Text variant="body" tone="ink2" numberOfLines={3}>
          {payload.text}
        </Text>
      ) : null}
    </View>
  );
}

const TargetRow = memo(function TargetRow({
  target,
  onPick,
}: {
  target: ShareTarget;
  onPick: (target: ShareTarget) => void;
}) {
  const theme = useTheme();
  const avatar = mediaUrl(target.avatar);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Send to ${target.name}, ${target.detail}`}
      onPress={() => onPick(target)}
      style={({ pressed }) => ({
        minHeight: 56,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        backgroundColor: pressed ? theme.tint2 : "transparent",
      })}
    >
      {target.kind === "dm" || avatar ? (
        <Avatar
          name={target.kind === "dm" ? target.name : target.detail}
          size={32}
          uri={avatar}
        />
      ) : (
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: RADIUS,
            borderWidth: 1,
            borderColor: theme.line,
            backgroundColor: theme.ply3,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon icon={Hash} size={16} color={theme.ink2} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="name" numberOfLines={1}>
          {target.name}
        </Text>
        <Text variant="row" tone="ink3" numberOfLines={1}>
          {target.detail}
        </Text>
      </View>
    </Pressable>
  );
});

const keyOf = (target: ShareTarget) => target.channelId;

/**
 * "Send to…": a share from another app picks its conversation here (recent
 * DMs and channels, or a search), then opens in that composer with the
 * files in the attach chips and the text in the field, ready to send.
 */
export default function ShareScreen() {
  const theme = useTheme();
  const payload = usePendingShare();
  const [query, setQuery] = useState("");
  const dms = useDmsStore((s) => s.dms);
  const servers = useServersStore((s) => s.servers);
  const trees = useServersStore((s) => s.trees);
  const lastMessageAt = useServersStore((s) => s.lastMessageAt);
  const targets = useMemo(
    () => shareTargets({ dms, servers, trees, lastMessageAt }, query),
    [dms, servers, trees, lastMessageAt, query],
  );

  useEffect(() => {
    if (useDmsStore.getState().dms.length === 0) void loadDms();
  }, []);

  const cancel = useCallback(() => {
    setPendingShare(null);
    if (router.canGoBack()) router.back();
    else router.replace("/home");
  }, []);

  const pick = useCallback((target: ShareTarget) => {
    stageShare(target.channelId);
    goToConversation({
      kind: target.kind,
      id: target.channelId,
      name: target.kind === "channel" ? target.name.slice(1) : undefined,
    });
  }, []);

  if (!payload) {
    return (
      <Screen scroll={false}>
        <Header title="Send to" onBack={cancel} />
        <EmptyState
          title="Nothing to send"
          description="Share a photo, a video or a link to Yap from another app."
          action={{ label: "Back", onPress: cancel }}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <Header title="Send to" onBack={cancel} />
      <SharePreview payload={payload} />
      <View style={{ flexDirection: "row", padding: 16, paddingBottom: 8 }}>
        <PickerSearch
          value={query}
          onChange={setQuery}
          placeholder="Search conversations"
          height={40}
        />
      </View>
      <Text
        variant="silk"
        tone="ink3"
        style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}
      >
        {query.trim() ? "Results" : "Recent"}
      </Text>
      <FlatList
        data={targets}
        keyExtractor={keyOf}
        renderItem={({ item }) => <TargetRow target={item} onPick={pick} />}
        keyboardShouldPersistTaps="handled"
        style={{ borderTopWidth: 1, borderTopColor: theme.line }}
        ListEmptyComponent={
          <EmptyState
            title={query.trim() ? "No matches" : "No conversations yet"}
            description={
              query.trim()
                ? "Try a channel, a server or a person's name."
                : "Your DMs and channels show up here once they load."
            }
          />
        }
      />
    </Screen>
  );
}
