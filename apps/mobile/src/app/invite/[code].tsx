import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Image, View } from "react-native";

import { showDrawer } from "@/features/conversation/store";
import { showServer } from "@/features/home/pane";
import {
  fetchInvite,
  joinInvite,
  type InvitePreview,
} from "@/features/invites/api";
import { loadServers } from "@/features/servers/actions";
import { serverInitials } from "@/features/servers/initials";
import { useServersStore } from "@/features/servers/store";
import { ApiError, mediaUrl } from "@/lib/api";
import { FONT, RADIUS, useTheme } from "@/theme";
import {
  Avatar,
  Button,
  EmptyState,
  Header,
  Screen,
  Skeleton,
  showToast,
  Text,
} from "@/ui";

const TILE = 88;

type Load =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly invite: InvitePreview }
  | { readonly status: "dead"; readonly expired: boolean }
  | { readonly status: "error" };

/** Back to home's drawer on `serverId`'s tree, closing this screen. */
function openServer(serverId: string): void {
  showServer(serverId);
  showDrawer();
  if (router.canDismiss()) router.dismissTo("/home");
  else router.replace("/home");
}

function ServerTile({ invite }: { invite: InvitePreview }) {
  const theme = useTheme();
  const icon = mediaUrl(invite.server.icon_url);
  return (
    <View
      style={{
        width: TILE,
        height: TILE,
        borderRadius: RADIUS,
        borderWidth: 1,
        borderColor: theme.line,
        backgroundColor: theme.ply3,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {icon ? (
        <Image
          source={{ uri: icon }}
          accessibilityIgnoresInvertColors
          style={{ width: TILE, height: TILE }}
        />
      ) : (
        <Text
          maxFontSizeMultiplier={1}
          style={{ fontFamily: FONT.display, fontSize: 30, color: theme.ink1 }}
        >
          {serverInitials(invite.server.name)}
        </Text>
      )}
    </View>
  );
}

function InviteSkeleton() {
  return (
    <View style={{ padding: 24, gap: 16 }}>
      <Skeleton width={96} height={12} />
      <Skeleton width={TILE} height={TILE} />
      <Skeleton width={220} height={24} />
      <Skeleton width={140} height={12} />
    </View>
  );
}

/** The plate: kicker, server tile, name, a readout line and who invited you. */
function InviteCard({ invite }: { invite: InvitePreview }) {
  const theme = useTheme();
  const count = invite.server.member_count;
  const inviter = invite.inviter;
  const inviterName = inviter
    ? inviter.display_name?.trim() || inviter.username
    : null;
  return (
    <View style={{ paddingHorizontal: 24, paddingTop: 24, gap: 16 }}>
      <Text variant="silk" tone="ink3">
        You are invited to join
      </Text>
      <ServerTile invite={invite} />
      <View style={{ gap: 6 }}>
        <Text variant="display" numberOfLines={2} accessibilityRole="header">
          {invite.server.name}
        </Text>
        {count !== undefined ? (
          <Text variant="num" tone="ink2">
            {count === 1 ? "1 member" : `${count} members`}
          </Text>
        ) : null}
      </View>
      {inviter && inviterName ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
            paddingTop: 16,
            borderTopWidth: 2,
            borderTopColor: theme.ink1,
          }}
        >
          <Avatar
            name={inviterName}
            size={28}
            uri={mediaUrl(inviter.avatar_url)}
          />
          <Text variant="row" tone="ink2" numberOfLines={1} style={{ flex: 1 }}>
            Invited by{" "}
            <Text variant="row" tone="ink1">
              {inviterName}
            </Text>
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * An invite link (web or the app's scheme): which server it leads to, and
 * Join, or Open when the user is already in it. Joining puts the server on
 * the rail and opens its tree.
 */
export default function InviteScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [joining, setJoining] = useState(false);
  const serverId = load.status === "ready" ? load.invite.server.id : null;
  const member = useServersStore((s) =>
    serverId ? s.servers.some((server) => server.id === serverId) : false,
  );

  const fetch = useCallback(
    () =>
      fetchInvite(code)
        .then((invite) => setLoad({ status: "ready", invite }))
        .catch((error: unknown) => {
          const dead =
            error instanceof ApiError &&
            (error.status === 404 || error.status === 410);
          setLoad(
            dead
              ? { status: "dead", expired: error.status === 410 }
              : { status: "error" },
          );
        }),
    [code],
  );
  const retry = useCallback(() => {
    setLoad({ status: "loading" });
    void fetch();
  }, [fetch]);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/home");
  }, []);

  const join = useCallback(async () => {
    if (!serverId || joining) return;
    if (member) {
      openServer(serverId);
      return;
    }
    setJoining(true);
    try {
      await joinInvite(code);
      await loadServers();
      openServer(serverId);
    } catch (error) {
      setJoining(false);
      const gone = error instanceof ApiError && error.status === 410;
      showToast({
        label: "Invite",
        text: gone ? "This invite has run out" : "Could not join. Try again.",
        led: "danger",
      });
    }
  }, [code, serverId, member, joining]);

  let body;
  if (load.status === "loading") body = <InviteSkeleton />;
  else if (load.status === "dead") {
    body = (
      <EmptyState
        title={load.expired ? "This invite has expired" : "Invite not found"}
        description="Ask whoever sent it for a new link."
        action={{ label: "Go to Ralph", onPress: close }}
      />
    );
  } else if (load.status === "error") {
    body = (
      <EmptyState
        title="Invite did not load"
        description="Check the connection and try again."
        action={{ label: "Try again", onPress: retry }}
      />
    );
  } else {
    body = <InviteCard invite={load.invite} />;
  }

  return (
    <Screen scroll={false}>
      <Header title="Invite" onBack={close} />
      <View style={{ flex: 1 }}>{body}</View>
      {load.status === "ready" ? (
        <View style={{ flexDirection: "row", gap: 8, padding: 16 }}>
          <View style={{ flex: 1 }}>
            <Button variant="ghost" label="Not now" onPress={close} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label={
                member ? "Open server" : joining ? "Joining…" : "Join server"
              }
              onPress={() => void join()}
            />
          </View>
        </View>
      ) : null}
    </Screen>
  );
}
