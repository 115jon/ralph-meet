/**
 * Dev-only fixture surfaces (see routes/ui-fixtures.tsx). Seeds the chat store
 * with static data and mounts the real components. Nothing here ships.
 *
 * Desktop shells drop their sidebar column below md, like the app, so
 * shell / shell-dm / voice-live also show the phone layout at 390.
 */

import ChannelSidebar from "@/components/chat/ChannelSidebar";
import { SearchFixture } from "@/components/dev/search-fixtures";
import { isSearchFixture } from "@/components/dev/search-fixture-surfaces";
import { PublicFixture } from "@/components/dev/public-fixtures";
import { PickerFixture } from "@/components/dev/picker-fixtures";
import { EmbedFixture } from "@/components/dev/embed-fixtures";
import { ActivityFixture } from "@/components/dev/activity-fixtures";
import {
  isSettingsProfileFixture,
  SettingsProfileFixture,
} from "@/components/dev/sp-fixtures";
import ChatArea from "@/components/chat/ChatArea";
import { ConnectionOverlay } from "@/components/chat/ConnectionOverlay";
import ContextMenu from "@/components/chat/ContextMenu";
import DMSidebar from "@/components/chat/DMSidebar";
import { EmptyChatArea } from "@/components/chat/EmptyChatArea";
import FriendsView from "@/components/chat/FriendsView";
import InviteModal from "@/components/chat/InviteModal";
import { PinModal } from "@/components/chat/PinModal";
import { PinnedMessagesSidebar } from "@/components/chat/PinnedMessagesSidebar";
import MessageItem from "@/components/chat/MessageItem";
import MemberList from "@/components/chat/MemberList";
import { UnreadBanner } from "@/components/chat/UnreadBanner";
import { MobileMessagesTab } from "@/components/chat/mobile/MobileMessagesTab";
import { DeleteMessageDialog } from "@/components/chat/DeleteMessageDialog";
import { RemoveEmbedsDialog } from "@/components/chat/RemoveEmbedsDialog";
import { DeleteSoundDialog } from "@/components/chat/DeleteSoundDialog";
import { RestartAppDialog } from "@/components/chat/settings/RestartAppDialog";
import ReactionDetailsModal from "@/components/chat/ReactionDetailsModal";
import { UploadSoundModal } from "@/components/chat/UploadSoundModal";
import CreateServerModal from "@/components/chat/CreateServerModal";
import CreateChannelModal from "@/components/chat/CreateChannelModal";
import CreateCategoryModal from "@/components/chat/CreateCategoryModal";
import MessageShareModal from "@/components/chat/MessageShareModal";
import { StartCallModal } from "@/components/chat/StartCallModal";
import { VoiceSwitchModal } from "@/components/chat/VoiceSwitchModal";
import VoiceChannelTextStatusModal from "@/components/chat/VoiceChannelTextStatusModal";
import VoiceChannelMediaStatusModal from "@/components/chat/VoiceChannelMediaStatusModal";
import { AudioInteractionModal } from "@/components/voice/AudioInteractionModal";
import { ExternalLinkConfirmModal } from "@/components/ui/ExternalLinkConfirmModal";
import { StreamContextMenu } from "@/components/StreamContextMenu";
import { MentionAutocomplete } from "@/components/chat/MentionAutocomplete";
import { HoveredMentionTooltip } from "@/components/chat/HoveredMentionTooltip";
import { ImageViewerModal } from "@/components/chat/ImageViewerModal";
import { useImageViewerStore } from "@/stores/useImageViewerStore";
import { MobileNavigationSheet } from "@/components/chat/MobileNavigationSheet";
import MobileProfileSheet from "@/components/chat/MobileProfileSheet";
import { SettingsHost } from "@/components/chat/SettingsHost";
import { ActionSheet } from "@/components/ui/action-sheet";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import ServerList from "@/components/chat/ServerList";
import { CatalogFixture, ShopFixture } from "@/components/dev/ShopFixtures";
import SettingsModal from "@/components/chat/SettingsModal";
import UserPanel from "@/components/chat/UserPanel";
import { WebAppTitleBar } from "@/components/chat/AppTitleBar";
import { ListenTogetherPanel } from "@/components/chat/ListenTogetherPanel";
import { useListenTogetherStore } from "@/stores/useListenTogetherStore";
import {
  clearStoredKovaAuthSessionToken,
  getStoredKovaAuthSessionToken,
  setStoredKovaAuthSessionToken,
} from "@/lib/desktop-auth";
import type {
  ListenTogetherQueueEntry,
  ListenTogetherSearchResponse,
  ListenTogetherStateSnapshot,
} from "@/lib/listen-together";
import shareFrame from "@/components/dev/assets/share-frame.webp";
import coverNightdrive from "@/components/dev/assets/cover-nightdrive.webp";
import coverPaperboats from "@/components/dev/assets/cover-paperboats.webp";
import coverCopperline from "@/components/dev/assets/cover-copperline.webp";
import coverSlowfires from "@/components/dev/assets/cover-slowfires.webp";
import coverGlasshouse from "@/components/dev/assets/cover-glasshouse.webp";
import coverTidelines from "@/components/dev/assets/cover-tidelines.webp";
import coverSmallhours from "@/components/dev/assets/cover-smallhours.webp";
import { SplashScreen } from "@/components/SplashScreen";
import { VoiceControls } from "@/components/voice/VoiceControls";
import { MembersTray, VoiceStage } from "@/components/voice/VoiceStage";
import { IncomingCallModal } from "@/components/chat/IncomingCallModal";
import {
  RoomConnecting,
  RoomJoinForm,
  RoomMeta,
} from "@/components/RoomPageClient";
import { DemoRoomChatPanel } from "@/components/DemoRoomChatPanel";
import { useCallStore } from "@/stores/useCallStore";
import { useCallVoiceStore } from "@/stores/useCallVoiceStore";
import { VoiceGrid } from "@/components/voice/VoiceGrid";
import { VoiceHeader } from "@/components/voice/VoiceHeader";
import { VoiceLanding } from "@/components/voice/VoiceLanding";
import type { GridItem } from "@/components/voice/types";
import type { ChatMember, VoiceChannelMember } from "@/lib/chat-reducer";
import type { Category, Channel, Message, Server, User } from "@/lib/types";
import { useChatStore } from "@/stores/chat-store";
import { type MobileTab, useMobileTabStore } from "@/stores/useMobileTabStore";
import { useSearch } from "@tanstack/react-router";
import { Icon } from "@/components/ui/icon";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import UserProfilePopover from "@/components/chat/UserProfilePopover";
import UserAccountPopover from "@/components/chat/UserAccountPopover";
import { AudioDeviceMenu } from "@/components/chat/AudioDeviceMenu";
import { VoiceDashboard } from "@/components/chat/VoiceDashboard";
import {
  applyCollectibleKit,
  isCollectibleKit,
} from "@/components/dev/collectible-kit";
import {
  ada as spAda,
  grace as spGrace,
  me as spMe,
} from "@/components/dev/sp-fixtures/profiles";

const NOW = Date.parse("2026-10-22T14:32:00Z");
const at = (minutesAgo: number) =>
  new Date(NOW - minutesAgo * 60_000).toISOString();

const users: Record<string, User> = {
  me: {
    id: "u-me",
    username: "jon",
    display_name: "Jon",
    status: "online",
    custom_status: "shipping the UI pass",
  },
  ada: {
    id: "u-ada",
    username: "ada",
    display_name: "Ada Lovelace",
    status: "online",
  },
  grace: {
    id: "u-grace",
    username: "grace",
    display_name: "Grace Hopper",
    status: "idle",
    custom_status: "in a meeting",
  },
  linus: {
    id: "u-linus",
    username: "linus",
    display_name: "Linus",
    status: "dnd",
  },
  margaret: {
    id: "u-margaret",
    username: "mhamilton",
    display_name: "Margaret Hamilton",
    status: "offline",
  },
  ken: { id: "u-ken", username: "ken", display_name: "Ken", status: "offline" },
};

const servers: Server[] = [
  { id: "s-1", name: "Ralph HQ", owner_id: "u-me", created_at: at(9000) },
  { id: "s-2", name: "Design Club", owner_id: "u-ada", created_at: at(8000) },
  { id: "s-3", name: "Night Shift", owner_id: "u-grace", created_at: at(7000) },
];

const categories: Category[] = [
  { id: "c-info", server_id: "s-1", name: "Information", rank: 0 },
  { id: "c-text", server_id: "s-1", name: "Text Channels", rank: 1 },
  { id: "c-voice", server_id: "s-1", name: "Voice Channels", rank: 2 },
];

const channels: Channel[] = [
  {
    id: "ch-welcome",
    server_id: "s-1",
    name: "welcome",
    channel_type: "text",
    category_id: "c-info",
    position: 0,
    created_at: at(9000),
  },
  {
    id: "ch-general",
    server_id: "s-1",
    name: "general",
    channel_type: "text",
    category_id: "c-text",
    position: 0,
    created_at: at(9000),
  },
  {
    id: "ch-design",
    server_id: "s-1",
    name: "design-system",
    channel_type: "text",
    category_id: "c-text",
    position: 1,
    created_at: at(9000),
  },
  {
    id: "ch-random",
    server_id: "s-1",
    name: "random",
    channel_type: "text",
    category_id: "c-text",
    position: 2,
    created_at: at(9000),
  },
  {
    id: "ch-lounge",
    server_id: "s-1",
    name: "Lounge",
    channel_type: "voice",
    category_id: "c-voice",
    position: 0,
    created_at: at(9000),
  },
  {
    id: "ch-standup",
    server_id: "s-1",
    name: "Standup",
    channel_type: "voice",
    category_id: "c-voice",
    position: 1,
    created_at: at(9000),
  },
  {
    id: "ch-empty",
    server_id: "s-1",
    name: "brand-new",
    channel_type: "text",
    category_id: "c-text",
    position: 3,
    created_at: at(2),
  },
];

/** ch-general with no SEND_MESSAGES for the viewer (read-only composer). */
const readOnlyChannels: Channel[] = channels.map((c) =>
  c.id === "ch-general" ? { ...c, permissions: 0 } : c,
);

const members: ChatMember[] = [
  { user: users.me!, roles: [adminRole()] },
  { user: users.ada!, roles: [adminRole()] },
  { user: users.grace!, roles: [modRole()] },
  { user: users.linus!, roles: [] },
  { user: users.margaret!, roles: [] },
  { user: users.ken!, roles: [] },
];

function adminRole() {
  return {
    id: "r-admin",
    server_id: "s-1",
    name: "Admin",
    color: "#f0b232",
    permissions: 1,
    position: 10,
    is_default: false,
    created_at: at(9000),
  };
}
function modRole() {
  return {
    id: "r-mod",
    server_id: "s-1",
    name: "Moderator",
    color: "#23a559",
    permissions: 0,
    position: 5,
    is_default: false,
    created_at: at(9000),
  };
}

function msg(
  id: string,
  author: User,
  content: string,
  minutesAgo: number,
  extra: Partial<Message> = {},
): Message {
  return {
    id,
    channel_id: "ch-general",
    author_id: author.id,
    author,
    content,
    is_pinned: false,
    created_at: at(minutesAgo),
    ...extra,
  };
}

const messages: Message[] = [
  msg("m-1", users.ada!, "Morning all. Pushing the new token scale today.", 95),
  msg(
    "m-2",
    users.ada!,
    "Spacing is now 4/8/12/16/24/32, radii are 6/8/12/16/20. Everything else is a bug.",
    94,
  ),
  msg(
    "m-3",
    users.grace!,
    "Finally. The `rounded-[24px]` on the settings card has been haunting me.",
    80,
    { reactions: [{ emoji: "😂", count: 3, me: true, users: ["u-me"] }] },
  ),
  msg(
    "m-4",
    users.linus!,
    "Can we also kill `transition-all`? 280 of them. Hover feels like it's dragging through syrup.",
    61,
    {
      reply_to_id: "m-2",
      reply_to: messages_m2(),
      is_pinned: true,
      reactions: [
        { emoji: "🔥", count: 5, me: false, users: ["u-ada", "u-grace"] },
        { emoji: "👀", count: 1, me: false, users: ["u-ken"] },
      ],
    },
  ),
  msg("m-5", users.me!, "On it. Also moving the tooltips to one style.", 40),
  msg(
    "m-6",
    users.me!,
    "Here's the reference pass, the sign-in page: **Figtree** for UI, _Instrument Serif_ for display, dithered art from the accent.",
    39,
    { updated_at: at(38) },
  ),
  msg("m-7", users.grace!, "https://ditherwave.dev/docs/getting-started", 12, {
    embeds: [
      {
        id: "e-1",
        url: "https://ditherwave.dev/docs/getting-started",
        type: "rich",
        rawTitle: "Getting started with ditherwave",
        rawDescription:
          "WebGL ordered dithering for canvases, images and video. Bayer, Floyd-Steinberg and dot modes with a custom palette.",
        provider: { name: "ditherwave" },
        color: "#5865f2",
        fields: [],
      },
    ],
  }),
  msg("m-8", users.grace!, "Attached the spec too.", 11, {
    attachments: [
      {
        id: "a-1",
        filename: "ui-audit-2026-10.pdf",
        file_key: "fixtures/ui-audit.pdf",
        content_type: "application/pdf",
        size_bytes: 412_000,
      },
    ],
  }),
  msg("m-9", users.ada!, "LGTM. Ship it when the screenshots match.", 3, {
    reply_count: 2,
  }),
];

function messages_m2(): Message {
  return msg(
    "m-2",
    users.ada!,
    "Spacing is now 4/8/12/16/24/32, radii are 6/8/12/16/20.",
    94,
  );
}

const dmChannels = [
  { id: "dm-ada", name: "Ada Lovelace", recipient: users.ada! },
  { id: "dm-grace", name: "Grace Hopper", recipient: users.grace! },
  { id: "dm-linus", name: "Linus", recipient: users.linus! },
];

const voiceFlags = {
  connected: true,
  self_mute: false,
  self_deaf: false,
  self_video: false,
  self_stream: false,
};
const voiceMembers: VoiceChannelMember[] = [
  {
    clerk_user_id: "u-ada",
    name: "Ada Lovelace",
    username: "ada",
    display_name: "Ada Lovelace",
    ...voiceFlags,
  },
  {
    clerk_user_id: "u-grace",
    name: "Grace Hopper",
    username: "grace",
    display_name: "Grace Hopper",
    ...voiceFlags,
  },
];

function seedStore(surface: string) {
  const isEmpty = surface === "shell-empty";
  const isDm = surface === "shell-dm";
  const activeChannelId = isEmpty ? "ch-empty" : isDm ? "dm-ada" : "ch-general";
  const list = isEmpty
    ? []
    : isDm
      ? messages.slice(0, 5).map((m) => ({ ...m, channel_id: "dm-ada" }))
      : messages;
  useChatStore.setState({
    connected: true,
    user: users.me!,
    servers,
    channels: surface === "shell-readonly" ? readOnlyChannels : channels,
    channelsByServerId: {
      "s-1": surface === "shell-readonly" ? readOnlyChannels : channels,
    },
    channelsLoadedByServerId: { "s-1": true },
    categories,
    categoriesByServerId: { "s-1": categories },
    activeServerId: isDm ? "@me" : "s-1",
    activeChannelId,
    messages: list,
    messagesByChannelId: { [activeChannelId]: list },
    messagesLoadedByChannelId: { [activeChannelId]: true },
    messageHasMoreBeforeByChannelId: { [activeChannelId]: false },
    messageHasMoreAfterByChannelId: { [activeChannelId]: false },
    members,
    membersByServerId: { "s-1": members },
    membersLoadedByServerId: { "s-1": true },
    onlineUsers: new Set(["u-me", "u-ada", "u-grace", "u-linus"]),
    readStates: { "ch-general": at(0), "ch-welcome": at(0) },
    lastMessageAt: {
      "ch-general": at(3),
      "ch-design": at(20),
      "ch-random": at(400),
      "dm-grace": at(5),
    },
    dmChannels: surface === "dm-empty" ? [] : dmChannels,
    voiceChannelStates: { "ch-lounge": voiceMembers },
    voiceChannelStartedAt: { "ch-lounge": NOW - 25 * 60_000 },
    channelMentionCounts: { "ch-design": 2 },
    serverMentionCounts: { "s-2": 4 },
    typingUsers: { "ch-general": new Set(["u-grace"]) },
    pinsLoadedByChannelId: { [activeChannelId]: true },
    pinnedMessagesByChannelId: { [activeChannelId]: [messages[3]!] },
    pinnedMessages: [messages[3]!],
    notifications: [
      {
        id: "n-1",
        type: "mention",
        channel_id: "ch-design",
        server_id: "s-1",
        message_id: "m-3",
        from_user: {
          id: "u-ada",
          username: "ada",
          display_name: "Ada Lovelace",
        },
        content: "@jon can you check the tab bar spacing on the 360 build?",
        is_read: false,
        created_at: at(4),
        channel_name: "design-system",
        server_name: "Ralph HQ",
      },
      {
        id: "n-2",
        type: "reply",
        channel_id: "ch-general",
        server_id: "s-1",
        message_id: "m-2",
        from_user: {
          id: "u-grace",
          username: "grace",
          display_name: "Grace Hopper",
        },
        content: "Agreed, ship it after the screenshots match.",
        is_read: false,
        created_at: at(38),
        channel_name: "general",
        server_name: "Ralph HQ",
      },
      {
        id: "n-3",
        type: "dm",
        channel_id: "dm-grace",
        server_id: null,
        message_id: "m-9",
        from_user: {
          id: "u-grace",
          username: "grace",
          display_name: "Grace Hopper",
        },
        content: "Lunch at noon?",
        is_read: true,
        created_at: at(300),
      },
    ],
    unreadNotificationCount: 2,
    // 0 friend, 1 blocked, 2 incoming, 3 outgoing: every Friends tab has rows.
    relationships: [
      { user: users.ada!, type: 0, created_at: at(100) },
      { user: users.grace!, type: 0, created_at: at(100) },
      { user: users.margaret!, type: 0, created_at: at(100) },
      { user: users.linus!, type: 2, created_at: at(10) },
      { user: users.ken!, type: 3, created_at: at(8) },
      {
        user: {
          id: "u-spam",
          username: "spambot",
          display_name: "Spam Bot",
          status: "offline",
        },
        type: 1,
        created_at: at(500),
      },
    ],
  } as never);
}

function Rail({ dm = false }: { dm?: boolean }) {
  return (
    <div className="z-10 flex w-[72px] shrink-0 flex-col items-center overflow-y-auto bg-rm-bg-floating scrollbar-none">
      <ServerList
        servers={servers}
        activeServerId={dm ? "@me" : "s-1"}
        activeChannelId={dm ? "dm-ada" : "ch-general"}
        onSelect={() => {}}
        channels={channels}
        channelsByServerId={{ "s-1": channels }}
        readStates={{ "ch-general": at(0) }}
        lastMessageAt={{ "ch-general": at(3), "ch-design": at(20) }}
        voiceChannelStates={{ "ch-lounge": voiceMembers }}
        serverMentionCounts={{ "s-2": 4 }}
        homeBadgeCount={dm ? 0 : 1}
        unreadDms={
          dm
            ? []
            : [
                {
                  channelId: "dm-grace",
                  recipient: users.grace!,
                  unreadCount: 1,
                },
              ]
        }
      />
    </div>
  );
}

function Shell({ surface }: { surface: string }) {
  const dm = surface === "shell-dm";
  const channelId =
    surface === "shell-empty" ? "ch-empty" : dm ? "dm-ada" : "ch-general";
  const channelName =
    surface === "shell-empty" ? "brand-new" : dm ? "Ada Lovelace" : "general";
  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-rm-bg-primary"
      data-app-layout="true"
    >
      <WebAppTitleBar />
      <div className="flex flex-1 overflow-hidden relative">
        <div className="hidden h-full w-[312px] shrink-0 flex-col bg-rm-bg-secondary md:flex">
          <div className="flex min-h-0 flex-1">
            <Rail dm={dm} />
            <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-rm-sidebar">
              {dm ? (
                <DMSidebar activeChannelId="dm-ada" onSelectDm={() => {}} />
              ) : (
                <ChannelSidebar
                  channels={channels}
                  categories={categories}
                  activeChannelId={channelId}
                  serverId="s-1"
                  serverName="Ralph HQ"
                  currentUserId="u-me"
                  onSelect={() => {}}
                  readStates={{ "ch-general": at(0), "ch-welcome": at(0) }}
                  lastMessageAt={{
                    "ch-general": at(3),
                    "ch-design": at(20),
                    "ch-random": at(400),
                  }}
                  voiceChannelStates={{ "ch-lounge": voiceMembers }}
                  channelMentionCounts={{ "ch-design": 2 }}
                  canReorder
                  canManageChannels
                />
              )}
            </div>
          </div>
          <div className="shrink-0 bg-rm-bg-secondary">
            <UserPanel
              user={users.me!}
              serverId="s-1"
              serverName="Ralph HQ"
              voiceConnected={false}
              voiceChannelId={null}
              voiceChannelName={undefined}
              onVoiceDisconnect={() => {}}
              onVoiceNavigate={() => {}}
              sfu={null}
              gridItems={[]}
              watchersByStreamer={{}}
              sidebarWidthPx={240}
            />
            <div className="h-2 shrink-0" aria-hidden="true" />
          </div>
        </div>
        <div className="chat-main-content relative flex min-w-0 flex-1 flex-col overflow-hidden bg-rm-bg-primary">
          <ChatArea
            channelId={channelId}
            channelName={channelName}
            onMenuClick={() => {}}
            onMembersClick={() => {}}
            showMembers={!dm && surface !== "shell-chat"}
            isDM={dm}
            serverId={dm ? undefined : "s-1"}
            dmUsername={dm ? "ada" : undefined}
            onCall={dm ? () => {} : undefined}
          />
        </div>
      </div>
    </div>
  );
}

function FriendsShell() {
  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-rm-bg-primary"
      data-app-layout="true"
    >
      <WebAppTitleBar />
      <div className="flex flex-1 overflow-hidden relative">
        <div className="hidden h-full w-[312px] shrink-0 flex-col bg-rm-bg-secondary md:flex">
          <div className="flex min-h-0 flex-1">
            <Rail dm />
            <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-rm-sidebar">
              <DMSidebar
                activeChannelId={null}
                activeView="friends"
                onSelectDm={() => {}}
              />
            </div>
          </div>
        </div>
        <div className="chat-main-content relative flex min-w-0 flex-1 flex-col overflow-hidden bg-rm-bg-primary">
          <FriendsView
            onMenuClick={() => {}}
            onSelectDm={() => {}}
            initialTab={
              (fixtureParam("tab") as
                | "online"
                | "all"
                | "pending"
                | "blocked") ?? undefined
            }
          />
        </div>
      </div>
    </div>
  );
}

const gridItems: GridItem[] = [
  {
    id: "g-me",
    userId: "u-me",
    name: "Jon",
    stream: null,
    isLocal: true,
    type: "avatar",
    isStreaming: false,
    isMuted: false,
    isDeafened: false,
    isSpeaking: true,
  },
  {
    id: "g-ada",
    userId: "u-ada",
    name: "Ada Lovelace",
    stream: null,
    isLocal: false,
    type: "avatar",
    isStreaming: false,
    isMuted: true,
    isDeafened: false,
    isSpeaking: false,
  },
  {
    id: "g-grace",
    userId: "u-grace",
    name: "Grace Hopper",
    stream: null,
    isLocal: false,
    type: "avatar",
    isStreaming: false,
    isMuted: false,
    isDeafened: true,
    isSpeaking: false,
  },
  {
    id: "g-linus",
    userId: "u-linus",
    name: "Linus",
    stream: null,
    isLocal: false,
    type: "avatar",
    isStreaming: false,
    isMuted: false,
    isDeafened: false,
    isSpeaking: false,
  },
];

const linusScreen: GridItem = {
  id: "g-linus-screen",
  userId: "u-linus",
  name: "Linus",
  stream: null,
  isLocal: false,
  type: "screen",
  isStreaming: true,
  isMuted: false,
  isDeafened: false,
  isSpeaking: false,
};

export const LISTEN_ROOM = "lounge";

export function listenEntry(
  id: string,
  title: string,
  artist: string,
  album: string,
  durationMs: number,
  art: string,
  requester: { id: string; name: string },
  requestedAt: number,
): ListenTogetherQueueEntry {
  return {
    entryId: `lt-${id}`,
    requestedAt,
    track: {
      kind: "music",
      id,
      provider: "youtube_music",
      videoId: id,
      title,
      artist,
      album,
      durationMs,
      artworkUrl: art,
      canonicalUrl: `https://music.youtube.com/watch?v=${id}`,
      sourceLabel: "YouTube Music",
    },
    requester: { userId: requester.id, displayName: requester.name },
  };
}

export function listenSnapshot(now: number): ListenTogetherStateSnapshot {
  const queue = [
    listenEntry(
      "fx-nightdrive",
      "Night Drive",
      "Lumen Arc",
      "Afterglow",
      254_000,
      coverNightdrive,
      { id: "u-ada", name: "Ada Lovelace" },
      now - 540_000,
    ),
    listenEntry(
      "fx-paperboats",
      "Paper Boats",
      "The Quiet Kind",
      "Low Tide",
      211_000,
      coverPaperboats,
      { id: "u-grace", name: "Grace Hopper" },
      now - 420_000,
    ),
    listenEntry(
      "fx-copperline",
      "Copper Line",
      "Marrow & Vale",
      "Field Notes",
      198_000,
      coverCopperline,
      { id: "u-me", name: "Jon" },
      now - 300_000,
    ),
    listenEntry(
      "fx-slowfires",
      "Slow Fires",
      "Lumen Arc",
      "Afterglow",
      276_000,
      coverSlowfires,
      { id: "u-linus", name: "Linus" },
      now - 120_000,
    ),
  ];
  const current = queue[0]!;
  return {
    roomSlug: LISTEN_ROOM,
    revision: 12,
    paused: false,
    currentEntryId: current.entryId,
    anchorPositionMs: 83_000,
    anchorUpdatedAt: now,
    lastUpdatedAt: now,
    recentlyPlayed: [],
    queue,
    currentEntry: current,
    positionMs: 83_000,
    durationMs:
      current.track.kind === "music" ? current.track.durationMs : null,
  };
}

const LISTEN_SEARCH: ListenTogetherSearchResponse = {
  filter: "track",
  cursor: null,
  results: [
    {
      kind: "track",
      id: "fx-glasshouse",
      provider: "youtube_music",
      videoId: "fx-glasshouse",
      title: "Glasshouse",
      artist: "Lumen Arc",
      album: "Afterglow",
      durationMs: 232_000,
      artworkUrl: coverGlasshouse,
      canonicalUrl: "https://music.youtube.com/watch?v=fx-glasshouse",
      sourceLabel: "YouTube Music",
    },
    {
      kind: "track",
      id: "fx-tidelines",
      provider: "youtube_music",
      videoId: "fx-tidelines",
      title: "Tidelines",
      artist: "Lumen Arc",
      album: "Afterglow",
      durationMs: 187_000,
      artworkUrl: coverTidelines,
      canonicalUrl: "https://music.youtube.com/watch?v=fx-tidelines",
      sourceLabel: "YouTube Music",
    },
    {
      kind: "track",
      id: "fx-smallhours",
      provider: "youtube_music",
      videoId: "fx-smallhours",
      title: "Small Hours (Live at Roundhouse)",
      artist: "Lumen Arc",
      album: "Live 2025",
      durationMs: 305_000,
      artworkUrl: coverSmallhours,
      canonicalUrl: "https://music.youtube.com/watch?v=fx-smallhours",
      sourceLabel: "YouTube Music",
    },
    {
      kind: "track",
      id: "fx-slowfires-s",
      provider: "youtube_music",
      videoId: "fx-slowfires",
      title: "Slow Fires",
      artist: "Lumen Arc",
      album: "Afterglow",
      durationMs: 276_000,
      artworkUrl: coverSlowfires,
      canonicalUrl: "https://music.youtube.com/watch?v=fx-slowfires",
      sourceLabel: "YouTube Music",
    },
    {
      kind: "collection",
      id: "fx-afterglow",
      provider: "youtube_music",
      title: "Afterglow",
      subtitle: "Album by Lumen Arc",
      itemCount: 11,
      artworkUrl: coverNightdrive,
      sourceUrl: "https://music.youtube.com/playlist?list=fx-afterglow",
    },
  ],
};

/**
 * Answers the panel's search request from the seed above so the surface
 * looks in use without a network. Installed only while the listen fixture
 * is mounted; every other request passes through. The API client refuses to
 * send anything without a session token, so a placeholder is stored for the
 * fixture's lifetime when the browser has none (a real one is left alone).
 */
export function installListenSearchStub() {
  const placeholderSession = getStoredKovaAuthSessionToken()
    ? null
    : "ui-fixture-session";
  if (placeholderSession) setStoredKovaAuthSessionToken(placeholderSession);
  const original = window.fetch;
  window.fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.includes("/api/listen-together/search")) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      return new Response(JSON.stringify(LISTEN_SEARCH), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return original(input, init);
  };
  return () => {
    window.fetch = original;
    if (placeholderSession) clearStoredKovaAuthSessionToken();
  };
}

/** Tile sub-states on one grid (12.13): speaking, ringing, server-muted,
 * an unwatched remote share (Watch prompt), the local share with its
 * preview paused, and a camera still loading. */
const tileStateItems: GridItem[] = [
  { ...gridItems[0]! },
  {
    ...gridItems[1]!,
    id: "g-ada-ring",
    isMuted: true,
    isRinging: true,
  },
  { ...gridItems[2]!, isMuted: true, isDeafened: false, serverMute: true },
  { ...linusScreen, id: "g-linus-unwatched" },
  {
    id: "g-me-screen",
    userId: "u-me",
    name: "Jon's Stream",
    stream: null,
    isLocal: true,
    type: "screen",
    isStreaming: true,
    isMuted: false,
    isDeafened: false,
    isSpeaking: false,
  },
  {
    id: "g-grace-cam",
    userId: "u-grace",
    name: "Grace Hopper",
    stream: null,
    isLocal: false,
    type: "camera",
    isStreaming: false,
    isMuted: false,
    isDeafened: false,
    isSpeaking: false,
  },
];

/** Eight people, so a phone has to scroll the grid (VC-21). */
const manyItems: GridItem[] = [
  ...gridItems,
  ...["Margaret", "Alan", "Katherine", "Dennis"].map(
    (name, i): GridItem => ({
      id: `g-extra-${i}`,
      userId: `u-extra-${i}`,
      name,
      stream: null,
      isLocal: false,
      type: "avatar",
      isStreaming: false,
      isMuted: i % 2 === 0,
      isDeafened: false,
      isSpeaking: false,
    }),
  ),
];

/**
 * `live`: mic muted, deafened, camera on and sharing, so every dock state
 * (rest / muted tint / live tint / solid leave) is visible at once.
 * `share`: Linus is sharing his screen (a real frame of the project's GitHub
 * page, served as a stream thumbnail so no MediaStream is needed); `focus`
 * opens it on the stage. `focusId` puts any tile on stage with the members
 * tray open. `listen`: a seeded Listen Together room with a track playing
 * and the queue panel open; search is answered from a local stub.
 */
function VoiceRoom({
  live = false,
  share = false,
  focus = false,
  listen = false,
  focusId = null,
  items: itemsOverride,
  connectionState = "connected",
}: {
  live?: boolean;
  share?: boolean;
  focus?: boolean;
  listen?: boolean;
  focusId?: string | null;
  items?: GridItem[];
  connectionState?: string;
}) {
  const [focusedId, setFocusedId] = useState<string | null>(
    focusId ?? (share && focus ? "g-linus-screen" : null),
  );
  const [showMembers, setShowMembers] = useState(true);
  const items =
    itemsOverride ?? (share ? [...gridItems, linusScreen] : gridItems);
  const focusedItem = items.find((g) => g.id === focusedId) ?? null;
  const watched: Record<string, boolean> = share ? { "u-linus": true } : {};
  const thumbnails: Record<string, string> =
    share || itemsOverride ? { "u-linus": shareFrame, "u-me": shareFrame } : {};
  const linusVoice = share
    ? [
        {
          clerk_user_id: "u-linus",
          name: "Linus",
          username: "linus",
          display_name: "Linus",
          ...voiceFlags,
          self_stream: true,
        },
      ]
    : [];
  const voiceActions = {
    isPreviewHidden: true,
    togglePreviewHidden: () => {},
    onToggleWatch: () => {},
  };

  useEffect(() => {
    if (!listen) return;
    const restoreFetch = installListenSearchStub();
    useListenTogetherStore
      .getState()
      .setSnapshot(LISTEN_ROOM, listenSnapshot(Date.now()));
    return () => {
      restoreFetch();
      useListenTogetherStore.getState().clearRoom(LISTEN_ROOM);
    };
  }, [listen]);
  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-rm-bg-primary"
      data-app-layout="true"
    >
      <WebAppTitleBar />
      <div className="flex flex-1 overflow-hidden relative">
        <div className="hidden h-full w-[312px] shrink-0 flex-col bg-rm-bg-secondary md:flex">
          <div className="flex min-h-0 flex-1">
            <Rail />
            <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-rm-sidebar">
              <ChannelSidebar
                channels={channels}
                categories={categories}
                activeChannelId="ch-lounge"
                serverId="s-1"
                serverName="Ralph HQ"
                currentUserId="u-me"
                onSelect={() => {}}
                voiceChannelStates={{
                  "ch-lounge": [
                    { clerk_user_id: "u-me", name: "Jon", ...voiceFlags },
                    ...voiceMembers,
                    ...linusVoice,
                  ],
                }}
                localVoiceChannelId="ch-lounge"
                localVoiceConnected
              />
            </div>
          </div>
          <div className="shrink-0 bg-rm-bg-secondary">
            <UserPanel
              user={users.me!}
              serverId="s-1"
              serverName="Ralph HQ"
              voiceConnected
              voiceChannelId="ch-lounge"
              voiceChannelName="Lounge"
              onVoiceDisconnect={() => {}}
              onVoiceNavigate={() => {}}
              isCameraActive={live}
              hasCamera
              hasMicrophone
              sfu={null}
              gridItems={items}
              watchersByStreamer={{}}
              sidebarWidthPx={240}
            />
            <div className="h-2 shrink-0" aria-hidden="true" />
          </div>
        </div>
        <div className="chat-main-content relative flex min-w-0 flex-1 flex-col overflow-hidden bg-rm-bg-primary">
          <VoiceStage
            header={
              <VoiceHeader
                channelName="Lounge"
                connectionState={connectionState}
                joined
                focusedItem={focusedItem}
                currentScreenQuality={undefined}
                sfu={null}
                showTextChat={false}
                onToggleTextChat={() => {}}
                onMenuClick={() => {}}
              />
            }
            tray={
              focusedId && showMembers ? (
                <MembersTray
                  items={items}
                  focusedId={focusedId}
                  onFocus={setFocusedId}
                  globalDeafened={false}
                  watchedStreams={watched}
                  streamThumbnails={thumbnails}
                  voiceActions={voiceActions}
                />
              ) : null
            }
            dock={
              <VoiceControls
                hasMicrophone
                isMicOn={!live}
                toggleMic={() => {}}
                isDeafened={live}
                toggleDeafen={() => {}}
                hasCamera
                isCameraOn={live}
                toggleCamera={() => {}}
                isScreenSharing={live}
                toggleScreenShare={() => {}}
                setIsScreenModalOpen={() => {}}
                focusedItem={focusedItem}
                setFocusedId={setFocusedId}
                handleLeave={() => {}}
                isFullscreen={false}
                toggleFs={() => {}}
                fullscreenSupported
                showMembers={showMembers}
                setShowMembers={setShowMembers}
                onOpenActivities={() => {}}
              />
            }
          >
            <VoiceGrid
              items={items}
              focusedId={focusedId}
              onFocus={setFocusedId}
              globalDeafened={false}
              currentSettings={{ peerSettings: {} }}
              watchedStreams={watched}
              streamThumbnails={thumbnails}
              voiceActions={voiceActions}
            />
            {listen && (
              <div className="absolute inset-0 z-30 flex items-center justify-center bg-rm-scrim">
                <div className="flex h-[min(600px,calc(100%-48px))] w-[min(1040px,calc(100%-48px))] flex-col overflow-hidden rounded-xl border border-rm-border bg-rm-bg-surface shadow-2xl dark:bg-rm-bg-elevated">
                  <ListenTogetherPanel
                    sfu={null}
                    roomSlug={LISTEN_ROOM}
                    voiceSessionId="fixture-voice-session"
                    serverId="s-1"
                    channelId="ch-lounge"
                    localUserId="u-me"
                  />
                </div>
              </div>
            )}
          </VoiceStage>
        </div>
      </div>
    </div>
  );
}

/**
 * The /room/$slug meeting (RoomPageClient) without a live session: the same
 * stage, header and dock the page renders once joined, plus the demo chat.
 * `room-join` and `room-connecting` show the steps before it.
 */
function RoomFixture({ step }: { step: "join" | "connecting" | "room" }) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  if (step === "join") {
    return (
      <RoomJoinForm
        slug="design-review"
        name={name}
        onNameChange={setName}
        onSubmit={(e) => e.preventDefault()}
        warnings={["No microphone detected"]}
      />
    );
  }
  if (step === "connecting") return <RoomConnecting slug="design-review" />;
  const focusedItem = gridItems.find((g) => g.id === focusedId) ?? null;
  return (
    <VoiceStage
      className="h-full"
      header={
        <VoiceHeader
          channelName="design-review"
          titleIcon="soundboard"
          connectionState="connected"
          joined
          focusedItem={focusedItem}
          currentScreenQuality={undefined}
          sfu={null}
          meta={
            <RoomMeta
              slug="design-review"
              focused={!!focusedItem}
              gridItemsCount={gridItems.length}
              localScreenWatchers={[]}
            />
          }
        />
      }
      dock={
        <VoiceControls
          hasMicrophone
          isMicOn
          toggleMic={() => {}}
          isDeafened={false}
          toggleDeafen={() => {}}
          hasCamera
          isCameraOn={false}
          toggleCamera={() => {}}
          isScreenSharing={false}
          toggleScreenShare={() => {}}
          setIsScreenModalOpen={() => {}}
          focusedItem={focusedItem}
          setFocusedId={setFocusedId}
          handleLeave={() => {}}
          isFullscreen={false}
          toggleFs={() => {}}
          fullscreenSupported
          showMembers={false}
          setShowMembers={() => {}}
          onOpenSettings={() => {}}
        />
      }
    >
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          <VoiceGrid
            items={gridItems}
            focusedId={focusedId}
            onFocus={setFocusedId}
            globalDeafened={false}
            currentSettings={{ peerSettings: {} }}
            watchedStreams={{}}
            streamThumbnails={{}}
          />
        </div>
        <DemoRoomChatPanel
          sfu={null}
          guestName="Jon"
          onUploadBlocked={() => {}}
          className="h-[42%] shrink-0 md:h-auto"
        />
      </div>
    </VoiceStage>
  );
}

/**
 * DM call region states, rendered by the real DMCallRegion inside the DM
 * shell (ChatArea mounts it) from seeded call stores.
 */
type DmCallStep = "ringing-out" | "ringing-in" | "lobby" | "active" | "video";

function seedDmCall(step: DmCallStep) {
  const me = { clerk_user_id: "u-me", name: "Jon", ...voiceFlags };
  const ada = {
    clerk_user_id: "u-ada",
    name: "Ada Lovelace",
    username: "ada",
    display_name: "Ada Lovelace",
    ...voiceFlags,
  };
  const members =
    step === "ringing-out"
      ? [me]
      : step === "ringing-in" || step === "lobby"
        ? [ada]
        : [me, { ...ada, self_mute: true }];
  useChatStore.setState({
    voiceChannelStates: { "ch-lounge": voiceMembers, "dm-ada": members },
  });
  const joined = step === "active" || step === "video";
  useCallStore.setState({
    status:
      step === "ringing-out"
        ? "ringing_outgoing"
        : step === "ringing-in"
          ? "ringing_incoming"
          : step === "lobby"
            ? "idle"
            : "active",
    callId: step === "lobby" ? null : "fx-call",
    remoteUser: {
      id: "u-ada",
      username: "ada",
      display_name: "Ada Lovelace",
    },
    channelId: step === "lobby" ? null : "dm-ada",
    hasConnected: joined,
    hasJoinedSFU: joined,
    voiceRoomId: "dm-call-u-ada-u-me",
  });
  const callItems: GridItem[] = [
    { ...gridItems[0]!, isSpeaking: true },
    { ...gridItems[1]!, isMuted: true },
    ...(step === "video"
      ? [
          {
            ...linusScreen,
            id: "g-ada-screen",
            userId: "u-ada",
            name: "Ada Lovelace",
          },
        ]
      : []),
  ];
  useCallVoiceStore.setState({
    joined,
    connectionState: "connected",
    gridItems: joined ? callItems : [],
    isMicOn: true,
    isDeafened: false,
    hasCamera: true,
    hasMicrophone: true,
    focusedId: null,
    streamThumbnails: step === "video" ? { "u-ada": shareFrame } : {},
    watchedStreams: step === "video" ? { "u-ada": true } : {},
    watchersByStreamer: {},
    toggleMic: () => {},
    toggleDeafen: () => {},
    setFocusedId: (id) => useCallVoiceStore.setState({ focusedId: id }),
  });
}

function DmCallFixture({ step }: { step: DmCallStep }) {
  // Seed before the first paint so the region mounts in its final state;
  // the surface is chosen once per page load.
  useState(() => seedDmCall(step));
  useEffect(
    () => () => {
      useCallStore.setState({ status: "idle", callId: null, channelId: null });
      useCallVoiceStore.getState().reset();
    },
    [],
  );
  return <Shell surface="shell-dm" />;
}

/** The incoming call card over a server channel (it hides inside the DM). */
function IncomingCallFixture() {
  useEffect(() => {
    useCallStore.setState({
      status: "ringing_incoming",
      callId: "fx-call",
      remoteUser: {
        id: "u-ada",
        username: "ada",
        display_name: "Ada Lovelace",
      },
      channelId: "dm-ada",
    });
    return () => {
      useCallStore.setState({ status: "idle", callId: null, channelId: null });
    };
  }, []);
  return (
    <div className="relative h-full w-full">
      <Shell surface="shell" />
      <IncomingCallModal />
    </div>
  );
}

function VoiceLandingFixture() {
  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-rm-bg-primary"
      data-app-layout="true"
    >
      <WebAppTitleBar />
      <div className="flex flex-1 overflow-hidden relative">
        <div className="hidden h-full w-[312px] shrink-0 flex-col bg-rm-bg-secondary md:flex">
          <div className="flex min-h-0 flex-1">
            <Rail />
            <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-rm-sidebar">
              <ChannelSidebar
                channels={channels}
                categories={categories}
                activeChannelId="ch-standup"
                serverId="s-1"
                serverName="Ralph HQ"
                currentUserId="u-me"
                onSelect={() => {}}
                voiceChannelStates={{ "ch-lounge": voiceMembers }}
              />
            </div>
          </div>
        </div>
        <div className="chat-main-content relative flex min-w-0 flex-1 flex-col overflow-hidden bg-rm-bg-primary">
          <VoiceLanding
            channelName="Standup"
            vcMembers={[]}
            handleJoin={() => {}}
            showTextChat={false}
            onToggleTextChat={() => {}}
          />
        </div>
      </div>
    </div>
  );
}

function Menus() {
  return (
    <div className="relative h-full w-full bg-rm-bg-primary">
      <Shell surface="shell" />
      <ContextMenu
        x={420}
        y={180}
        items={[
          {
            label: "Mark As Read",
            icon: <Icon name="check" size="sm" />,
            onClick: () => {},
            divider: true,
          },
          {
            label: "Copy Link",
            icon: <Icon name="copy" size="sm" />,
            onClick: () => {},
          },
          {
            label: "Notification Settings",
            subtitle: "All Messages",
            icon: <Icon name="check" size="sm" />,
            onClick: () => {},
            disabled: true,
            divider: true,
          },
          {
            label: "Delete Channel",
            icon: <Icon name="trash" size="sm" />,
            onClick: () => {},
            variant: "danger",
          },
        ]}
        onClose={() => {}}
      />
      <InviteModal
        open
        serverId="s-1"
        serverName="Ralph HQ"
        onClose={() => {}}
      />
    </div>
  );
}

/**
 * Headless Chrome (and any browser before media permission is granted) lists
 * devices with an empty deviceId and label. Give the settings fixtures named
 * devices with stable ids so the device pickers render like a real machine.
 */
const FIXTURE_DEVICES: MediaDeviceInfo[] = (
  [
    ["audioinput", "default", "Default - Shure MV7 (USB Audio)", "g-mv7"],
    ["audioinput", "mic-mv7", "Shure MV7 (USB Audio)", "g-mv7"],
    ["audioinput", "mic-wave3", "Elgato Wave:3", "g-wave"],
    ["audiooutput", "default", "Default - HD 600 (Schiit Modi+)", "g-modi"],
    ["audiooutput", "out-modi", "HD 600 (Schiit Modi+)", "g-modi"],
    ["audiooutput", "out-speakers", "Speakers (Realtek Audio)", "g-rt"],
    ["videoinput", "cam-c920", "Logitech C920", "g-c920"],
    ["videoinput", "cam-obs", "OBS Virtual Camera", "g-obs"],
  ] as const
).map(
  ([kind, deviceId, label, groupId]) =>
    ({
      kind,
      deviceId,
      label,
      groupId,
      toJSON: () => ({}),
    }) as MediaDeviceInfo,
);

function useFixtureDevices() {
  const [ready] = useState(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      return true;
    }
    navigator.mediaDevices.enumerateDevices = () =>
      Promise.resolve(FIXTURE_DEVICES);
    return true;
  });
  return ready;
}

/** Extra fixture query params the route doesn't validate (row, desktop). */
function fixtureParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

function SettingsFixture({ tab }: { tab?: string }) {
  useFixtureDevices();
  return (
    <div className="relative h-full w-full bg-rm-bg-primary">
      <Shell surface="shell" />
      <SettingsModal
        open
        onClose={() => {}}
        initialTab={(tab as never) ?? "appearance"}
        initialRow={fixtureParam("row") ?? undefined}
        environment={
          tab === "desktop" || fixtureParam("desktop") === "1"
            ? { desktop: true }
            : undefined
        }
      />
    </div>
  );
}

function OverlayFixture() {
  useEffect(() => {
    useChatStore.setState({ connected: false, reconnectAttempt: 2 } as never);
  }, []);
  return (
    <div className="relative h-full w-full">
      <ConnectionOverlay />
    </div>
  );
}

function MobileFixture({ surface }: { surface: string }) {
  if (surface === "mobile-sidebar") {
    return (
      <div className="flex h-full w-full overflow-hidden bg-rm-bg-primary">
        <Rail />
        <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-rm-sidebar">
          <ChannelSidebar
            channels={channels}
            categories={categories}
            activeChannelId="ch-general"
            serverId="s-1"
            serverName="Ralph HQ"
            currentUserId="u-me"
            onSelect={() => {}}
            voiceChannelStates={{ "ch-lounge": voiceMembers }}
            channelMentionCounts={{ "ch-design": 2 }}
          />
        </div>
      </div>
    );
  }
  return (
    <div className="chat-main-content relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-rm-bg-primary">
      <ChatArea
        channelId="ch-general"
        channelName="general"
        onMenuClick={() => {}}
        onMembersClick={() => {}}
        showMembers={false}
        serverId="s-1"
      />
    </div>
  );
}

/**
 * Message rows in a bare chat column: the unread banner on top, then rows
 * with a reply, pinned badge, reactions (one reacted), an embed and a file.
 * Shoot with a hover on a row to see the 12.12 hover bar.
 */
function MessageRowsFixture() {
  return (
    <div className="flex h-full flex-col bg-rm-bg-primary">
      <UnreadBanner count={3} since={at(12)} onMarkAsRead={() => {}} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6">
        {messages.slice(1).map((message, index, list) => (
          <MessageItem
            key={message.id}
            id={`message-${message.id}`}
            message={message}
            showHeader={
              index === 0 || list[index - 1]!.author_id !== message.author_id
            }
            currentUserId="u-me"
            canPin
            onReply={() => {}}
            onPin={() => {}}
            onUnpin={() => {}}
            onJump={() => {}}
            onThread={() => {}}
          />
        ))}
      </div>
    </div>
  );
}

/** Empty DM list: sidebar on desktop, the Messages tab page on phones. */
function DmEmptyFixture() {
  return (
    <>
      <div className="hidden h-full md:block">
        <FriendsShell />
      </div>
      <div className="h-full md:hidden">
        <MobileMessagesTab onSelectDm={() => {}} onNavigate={() => {}} />
      </div>
    </>
  );
}

/**
 * The channel details page (members + Media/Pins/Threads/Links/Files tabs),
 * as the phone shows it full height, and as the desktop details column.
 */
function MembersPageFixture() {
  return (
    <div className="flex h-full w-full justify-end bg-rm-bg-primary">
      <div className="flex h-full w-full flex-col bg-rm-bg-surface md:w-[360px] md:border-l md:border-rm-border">
        <MemberList
          members={members}
          onlineUsers={new Set(["u-me", "u-ada", "u-grace", "u-linus"])}
          currentUserId="u-me"
          channelName="general"
          channelId={null}
          serverId="s-1"
          pinnedMessages={[messages[3]!]}
          onClose={() => {}}
          onOpenSearch={() => {}}
          onOpenSettings={() => {}}
          onInviteClick={() => {}}
          showDetails
          onToggleDetails={() => {}}
        />
      </div>
    </div>
  );
}

/**
 * Phone home with the bottom tab bar: `mobile-home&tab=servers|messages|
 * notifications|you`.
 */
function MobileHomeFixture() {
  const [open, setOpen] = useState(true);
  useState(() => {
    useMobileTabStore.setState({
      tab: (fixtureParam("tab") ?? "servers") as MobileTab,
    });
    return true;
  });
  return (
    <div className="relative h-full w-full">
      <MobileFixture surface="mobile" />
      <MobileNavigationSheet
        open={open}
        onClose={() => setOpen(false)}
        onSelectDm={() => {}}
        serverList={<Rail />}
        current={
          <div className="h-full min-h-0 overflow-hidden bg-rm-bg-secondary">
            <ChannelSidebar
              channels={channels}
              categories={categories}
              activeChannelId="ch-general"
              serverId="s-1"
              serverName="Ralph HQ"
              currentUserId="u-me"
              onSelect={() => {}}
              voiceChannelStates={{ "ch-lounge": voiceMembers }}
              channelMentionCounts={{ "ch-design": 2 }}
            />
          </div>
        }
      />
    </div>
  );
}

/**
 * A message's long-press menu as the phone action sheet (the same ContextMenu
 * the desktop right-click uses), with the quick-reaction strip on top.
 */
function ActionSheetFixture() {
  return (
    <div className="relative h-full w-full">
      <MobileFixture surface="mobile" />
      <ContextMenu
        x={0}
        y={0}
        topContent={
          <div className="flex items-center gap-1 px-1">
            {["👍", "🔥", "😂", "👀", "🎉"].map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`React with ${emoji}`}
                className="flex h-11 w-11 items-center justify-center rounded-lg bg-rm-tint-1 text-ui-xl"
              >
                {emoji}
              </button>
            ))}
          </div>
        }
        items={[
          {
            label: "Reply",
            icon: <Icon name="reply" size="sm" />,
            onClick: () => {},
          },
          {
            label: "Forward",
            icon: <Icon name="forward" size="sm" />,
            onClick: () => {},
          },
          {
            label: "Create Thread",
            icon: <Icon name="thread" size="sm" />,
            onClick: () => {},
            divider: true,
          },
          {
            label: "Copy Text",
            icon: <Icon name="copy" size="sm" />,
            onClick: () => {},
          },
          {
            label: "Pin Message",
            icon: <Icon name="pin" size="sm" />,
            onClick: () => {},
          },
          {
            label: "Mark Unread",
            icon: <Icon name="markUnread" size="sm" />,
            onClick: () => {},
            divider: true,
          },
          {
            label: "Delete Message",
            icon: <Icon name="trash" size="sm" />,
            onClick: () => {},
            variant: "danger",
          },
        ]}
        onClose={() => {}}
      />
    </div>
  );
}

/**
 * The bottom Drawer primitive over the phone chat: a field (soft keyboard), a
 * long list that must scroll on touch without dragging the sheet, and a
 * nested action sheet.
 */
function DrawerFixture() {
  const [open, setOpen] = useState(true);
  const [actionsOpen, setActionsOpen] = useState(false);
  return (
    <div className="relative h-full w-full">
      <MobileFixture surface="mobile" />
      {open ? null : (
        <Button
          className="absolute top-24 left-4 z-10"
          onClick={() => setOpen(true)}
        >
          Open drawer
        </Button>
      )}
      <Drawer open={open} onOpenChange={setOpen} repositionInputs>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Invite to Ralph HQ</DrawerTitle>
            <DrawerDescription>
              Anyone with the link can join. It expires in 7 days.
            </DrawerDescription>
          </DrawerHeader>
          <input
            aria-label="Search members"
            placeholder="Search members"
            className="mx-4 min-h-12 rounded-lg border border-rm-border bg-rm-bg-primary px-3 text-ui-base text-rm-text"
          />
          <ul
            data-testid="drawer-fixture-list"
            className="mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4"
          >
            {Array.from({ length: 40 }, (_, index) => (
              <li
                key={index}
                className="flex min-h-12 items-center border-b border-rm-border text-ui-base text-rm-text"
              >
                Member {index + 1}
              </li>
            ))}
          </ul>
          <DrawerFooter>
            <Button
              size="lg"
              className="min-h-11 w-full"
              onClick={() => setActionsOpen(true)}
            >
              More actions
            </Button>
            <Button
              size="lg"
              variant="secondary"
              className="min-h-11 w-full"
              onClick={() => setOpen(false)}
            >
              Done
            </Button>
          </DrawerFooter>
          <ActionSheet
            open={actionsOpen}
            onOpenChange={setActionsOpen}
            title="Invite actions"
            items={[
              { label: "Copy link", onClick: () => {} },
              { label: "Share", onClick: () => {} },
              { label: "Revoke link", onClick: () => {}, variant: "danger" },
            ]}
          />
        </DrawerContent>
      </Drawer>
    </div>
  );
}

/**
 * A drawer opened from inside a Radix Dialog (the image viewer's action
 * sheet, the voice status modal's emoji picker): the drawer must take taps,
 * focus and typing, and closing it must leave the dialog open.
 */
function DrawerOverDialogFixture() {
  const [dialogOpen, setDialogOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  return (
    <div className="relative h-full w-full">
      <MobileFixture surface="mobile" />
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogTitle>Set a status</DialogTitle>
          <Button onClick={() => setDrawerOpen(true)}>Pick emoji</Button>
          <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
            <DrawerContent>
              <DrawerHeader>
                <DrawerTitle>Emoji</DrawerTitle>
              </DrawerHeader>
              <input
                aria-label="Search emoji"
                placeholder="Search emoji"
                className="mx-4 min-h-12 rounded-lg border border-rm-border bg-rm-bg-primary px-3 text-ui-base text-rm-text"
              />
              <DrawerFooter>
                <Button
                  size="lg"
                  className="min-h-11 w-full"
                  onClick={() => setDrawerOpen(false)}
                >
                  Done
                </Button>
              </DrawerFooter>
            </DrawerContent>
          </Drawer>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Member profile drawer over the phone chat. `mobile-profile-me` is self. */
function MobileProfileFixture({ self }: { self: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="relative h-full w-full">
      <MobileFixture surface="mobile" />
      <MobileProfileSheet
        open={open}
        user={self ? users.me! : { ...users.ada!, bio: "First programmer." }}
        onClose={() => setOpen(false)}
        onOpenProfileEditor={() => {}}
      />
    </div>
  );
}

// ─── Overlay fixtures (design-audit units 7-9) ──────────────────────────────
//
// Each `ov-*` surface mounts one overlay open over the shell, so it can be
// shot at 390 and 1280 in both themes. Overlays that open from a control in
// the shell (pins, members, bell, account, audio devices, profile) are shot
// from the `shell` surface with a click instead.

const noop = () => {};
const noopAsync = async () => {};

function OverShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative h-full w-full bg-rm-bg-primary">
      <Shell surface="shell-chat" />
      {children}
    </div>
  );
}

const loungeChannel = channels.find((c) => c.id === "ch-lounge")!;

function OverlaySurface({ surface }: { surface: string }) {
  switch (surface) {
    case "ov-pin":
    case "ov-unpin":
      return (
        <OverShell>
          <PinModal
            isOpen
            onClose={noop}
            onConfirm={noop}
            message={messages[3]!}
            mode={surface === "ov-pin" ? "pin" : "unpin"}
            channelName="general"
          />
        </OverShell>
      );
    case "ov-reactions":
      return (
        <OverShell>
          <ReactionDetailsModal
            open
            message={messages[3]!}
            initialEmoji="🔥"
            canManageReactions
            customEmojiMap={{}}
            onRemoveReaction={noop}
            onClose={noop}
          />
        </OverShell>
      );
    case "ov-upload-sound":
      return (
        <OverShell>
          <UploadSoundModal
            open
            onClose={noop}
            onUpload={noopAsync}
            isUploading={false}
          />
        </OverShell>
      );
    case "ov-create-server":
      return (
        <OverShell>
          <CreateServerModal open onClose={noop} />
        </OverShell>
      );
    case "ov-create-channel":
      return (
        <OverShell>
          <CreateChannelModal open serverId="s-1" onClose={noop} />
        </OverShell>
      );
    case "ov-create-category":
      return (
        <OverShell>
          <CreateCategoryModal open serverId="s-1" onClose={noop} />
        </OverShell>
      );
    case "ov-share":
      return (
        <OverShell>
          <MessageShareModal
            open
            message={messages[5]!}
            onClose={noop}
            onCreateShare={async () => "https://example.test/s/abc123"}
          />
        </OverShell>
      );
    case "ov-start-call":
      return (
        <OverShell>
          <StartCallModal
            open
            targetName="Ada Lovelace"
            onConfirm={noop}
            onCancel={noop}
          />
        </OverShell>
      );
    case "ov-voice-switch":
      return (
        <OverShell>
          <VoiceSwitchModal
            open
            targetName="Lounge"
            currentType="voice"
            onConfirm={noop}
            onCancel={noop}
          />
        </OverShell>
      );
    case "ov-voice-text-status":
      return (
        <OverShell>
          <VoiceChannelTextStatusModal
            open
            channel={loungeChannel}
            onClose={noop}
          />
        </OverShell>
      );
    case "ov-voice-media-status":
      return (
        <OverShell>
          <VoiceChannelMediaStatusModal
            open
            channel={loungeChannel}
            onClose={noop}
          />
        </OverShell>
      );
    case "ov-audio-interaction":
      return (
        <OverShell>
          <AudioInteractionModal open onInteract={noop} onClose={noop} />
        </OverShell>
      );
    case "ov-external-link":
      return (
        <OverShell>
          <ExternalLinkConfirmModal
            open
            pending={{
              url: "https://ditherwave.dev/docs/getting-started",
              hostname: "ditherwave.dev",
            }}
            trustDomain={false}
            onTrustDomainChange={noop}
            onClose={noop}
            onConfirm={noop}
          />
        </OverShell>
      );
    case "ov-stream-menu":
      return (
        <OverShell>
          <StreamContextMenu
            userId="u-ada"
            x={420}
            y={220}
            onClose={noop}
            isStreaming
            onOpenProfile={noop}
            onOpenMessage={noop}
          />
        </OverShell>
      );
    case "ov-stream-menu-self":
      return (
        <OverShell>
          <StreamContextMenu
            userId="me"
            x={420}
            y={220}
            onClose={noop}
            isStreaming
            isCurrentUserStreaming
            currentScreenQuality="1080p60"
            availableQualities={["720p30", "1080p30", "1080p60"]}
            onToggleScreenShare={noop}
            onToggleStreamAudio={noop}
            onChangeSource={noop}
            onLeave={noop}
            onToggleMute={noop}
            onToggleDeafen={noop}
          />
        </OverShell>
      );
    case "ov-voice-dashboard":
    case "ov-voice-details":
    case "ov-stream-settings":
    case "ov-noise-menu":
      return <VoiceDashboardFixture surface={surface} />;
    case "ov-profile":
    case "ov-account":
    case "ov-audio-device":
      return <AnchoredFixture surface={surface} />;
    case "ov-delete-message":
      return (
        <OverShell>
          <DeleteMessageDialog
            open
            onOpenChange={noop}
            onConfirm={noop}
            preview={
              <MessageItem
                message={messages[4]!}
                showHeader
                currentUserId="u-me"
                previewOnly
              />
            }
          />
        </OverShell>
      );
    case "ov-remove-embeds":
      return (
        <OverShell>
          <RemoveEmbedsDialog open onOpenChange={noop} onConfirm={noop} />
        </OverShell>
      );
    case "ov-sound-delete":
      return (
        <OverShell>
          <DeleteSoundDialog
            open
            onOpenChange={noop}
            soundName="Airhorn"
            soundEmoji="📯"
            onConfirm={noop}
          />
        </OverShell>
      );
    case "ov-desktop-restart":
      return (
        <OverShell>
          <RestartAppDialog
            open
            onOpenChange={noop}
            onConfirm={noop}
            title="Turn off hardware acceleration?"
          />
        </OverShell>
      );
    case "ov-pins-empty":
    case "ov-pins-loading":
      return (
        <OverShell>
          <PinnedMessagesSidebar
            open
            messages={[]}
            isLoading={surface === "ov-pins-loading"}
            onClose={noop}
            onJumpToMessage={noop}
            onUnpin={noop}
            canUnpin
          />
        </OverShell>
      );
    case "ov-mention":
      return <MentionFixture />;
    case "ov-image-viewer":
      return <ImageViewerFixture />;
    default:
      return <Shell surface="shell" />;
  }
}

/**
 * The voice dock (VoiceDashboard) in the sidebar column while live. The
 * stream-settings, noise and details popovers open from it with a click
 * (the shot script clicks the trigger named after the surface).
 */
function VoiceDashboardFixture({ surface }: { surface: string }) {
  useFixtureDevices();
  return (
    <OverShell>
      <div className="fixed bottom-0 left-0 z-20 w-[312px] max-md:w-full border-t border-rm-border bg-rm-bg-secondary">
        <VoiceDashboard
          serverName="Ralph HQ"
          voiceChannelName="Lounge"
          voiceChannelId="ch-lounge"
          serverId="s-1"
          localUserId="u-me"
          voiceSettingsUserId="u-me"
          isScreenSharing={surface !== "ov-voice-details"}
          isStreamingAudio
          screenQuality="1080p60"
          availableQualities={["720p30", "1080p30", "1080p60"]}
          isCameraActive={false}
          hasCamera
          hasMicrophone
          onVoiceDisconnect={noop}
          onVoiceNavigate={noop}
          onShareScreen={noop}
          onStopStreaming={noop}
          onToggleStreamAudio={noop}
          onChangeStreamSource={noop}
          onStreamQualityChange={noop}
          onToggleCamera={noop}
          onOpenVoiceSettings={noop}
        />
      </div>
    </OverShell>
  );
}

/** Popovers anchored to a control: profile card, account menu, audio devices. */
function AnchoredFixture({ surface }: { surface: string }) {
  useFixtureDevices();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const anchorRef = useMemo(() => ({ current: anchor }), [anchor]);
  const bottomLeft = surface !== "ov-profile";
  return (
    <OverShell>
      <button
        type="button"
        ref={setAnchor}
        aria-label="Fixture anchor"
        className={cn(
          "fixed z-20 size-8 rounded-full bg-rm-tint-2",
          bottomLeft
            ? "bottom-3 left-4"
            : "top-40 right-[260px] max-md:right-4",
        )}
      />
      {anchor && surface === "ov-profile" ? (
        <UserProfilePopover
          userId="u-grace"
          username="grace"
          displayName="Grace Hopper"
          seedUser={users.grace!}
          anchorEl={anchor}
          onClose={noop}
          side="left"
          align="start"
        />
      ) : null}
      {anchor && surface === "ov-account" ? (
        <UserAccountPopover
          user={users.me!}
          onClose={noop}
          updateStatus={noop}
          onOpenProfileEditor={noop}
          anchorEl={anchor}
        />
      ) : null}
      {anchor && surface === "ov-audio-device" ? (
        <AudioDeviceMenu
          mode="input"
          anchorRef={anchorRef}
          onClose={noop}
          onOpenVoiceSettings={noop}
        />
      ) : null}
    </OverShell>
  );
}

/** Composer-anchored mention list and the hovered-mention tooltip. */
function MentionFixture() {
  const candidates = [users.ada!, users.grace!, users.linus!, users.margaret!];
  return (
    <OverShell>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 px-2 pb-24 md:left-[312px] md:px-4">
        <div className="pointer-events-auto relative h-10">
          <MentionAutocomplete
            mentionQuery={{ query: "a", start: 0 }}
            mentionCandidates={candidates}
            mentionIndex={0}
            setLocalState={noop}
            insertMention={noop}
          />
        </div>
      </div>
      <HoveredMentionTooltip
        hoveredMember={members.find((m) => m.user.id === "u-grace")}
        pos={{ left: 220, top: 260 }}
      />
    </OverShell>
  );
}

function ImageViewerFixture() {
  const open = useImageViewerStore((s) => s.actions.open);
  useEffect(() => {
    open(
      [
        {
          id: "img-1",
          filename: "share-frame.webp",
          file_key: "fixtures/share-frame.webp",
          url: shareFrame,
          content_type: "image/webp",
          size_bytes: 182_000,
        },
      ],
      0,
      {
        author: users.grace!,
        createdAt: at(11),
        messageId: "m-8",
        channelId: "ch-general",
      } as never,
    );
  }, [open]);
  return (
    <OverShell>
      <ImageViewerModal />
    </OverShell>
  );
}

export default function UiFixtures() {
  const { surface, theme } = useSearch({ from: "/ui-fixtures" });
  const { setTheme } = useTheme();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const kit = fixtureParam("kit");
    if (isCollectibleKit(kit)) {
      applyCollectibleKit(
        [users.me, users.ada, users.grace, spMe, spAda, spGrace],
        kit,
        fixtureParam("frame"),
      );
    }
    seedStore(surface);
    setTheme(theme);
    const id = window.setTimeout(() => setReady(true), 0);
    return () => window.clearTimeout(id);
  }, [surface, theme, setTheme]);

  if (!ready) return <div className="h-full w-full bg-rm-bg-primary" />;

  let content: React.ReactNode;
  const surfaceName: string = surface;
  switch (surfaceName) {
    case "friends":
      content = <FriendsShell />;
      break;
    case "voice":
      content = <VoiceRoom />;
      break;
    case "voice-live":
      content = <VoiceRoom live />;
      break;
    case "voice-share":
      content = <VoiceRoom share focus />;
      break;
    case "voice-share-grid":
      content = <VoiceRoom share />;
      break;
    case "voice-listen":
      content = <VoiceRoom listen />;
      break;
    case "voice-landing":
      content = <VoiceLandingFixture />;
      break;
    case "voice-focus":
      content = <VoiceRoom focusId="g-ada" />;
      break;
    case "voice-tiles":
      content = <VoiceRoom items={tileStateItems} />;
      break;
    case "voice-many":
      content = <VoiceRoom items={manyItems} />;
      break;
    case "voice-connecting":
      content = <VoiceRoom connectionState="connecting" />;
      break;
    case "voice-reconnecting":
      content = <VoiceRoom connectionState="reconnecting" />;
      break;
    case "voice-failed":
      content = <VoiceRoom connectionState="failed" />;
      break;
    case "room":
      content = <RoomFixture step="room" />;
      break;
    case "room-join":
      content = <RoomFixture step="join" />;
      break;
    case "room-connecting":
      content = <RoomFixture step="connecting" />;
      break;
    case "dm-call-ringing-out":
    case "dm-call-ringing-in":
    case "dm-call-lobby":
    case "dm-call-active":
    case "dm-call-video":
      content = (
        <DmCallFixture
          step={surfaceName.replace("dm-call-", "") as DmCallStep}
        />
      );
      break;
    case "incoming-call":
      content = <IncomingCallFixture />;
      break;
    case "menus":
      content = <Menus />;
      break;
    case "splash":
      content = <SplashScreen />;
      break;
    case "overlay":
      content = <OverlayFixture />;
      break;
    case "no-channel":
      content = (
        <div className="flex h-full w-full">
          <EmptyChatArea onMenuClick={() => {}} />
        </div>
      );
      break;
    case "action-sheet":
      content = <ActionSheetFixture />;
      break;
    case "drawer":
      content = <DrawerFixture />;
      break;
    case "drawer-over-dialog":
      content = <DrawerOverDialogFixture />;
      break;
    case "mobile-home":
      content = <MobileHomeFixture />;
      break;
    case "mobile-profile":
    case "mobile-profile-me":
      content = <MobileProfileFixture self={surface === "mobile-profile-me"} />;
      break;
    case "shop":
      content = <ShopFixture />;
      break;
    case "catalog-decorations":
    case "catalog-effects":
    case "catalog-nameplates":
    case "catalog-frames":
      content = <CatalogFixture surface={surfaceName} />;
      break;
    case "mobile":
    case "mobile-sidebar":
      content = <MobileFixture surface={surface} />;
      break;
    case "message-rows":
      content = <MessageRowsFixture />;
      break;
    case "dm-empty":
      // The DM list with no conversations: desktop sidebar ≥md, the phone
      // Messages tab below.
      content = <DmEmptyFixture />;
      break;
    case "members":
      content = <MembersPageFixture />;
      break;
    default:
      content = surfaceName.startsWith("ov-") ? (
        <OverlaySurface surface={surfaceName} />
      ) : surfaceName.startsWith("pub-") ? (
        <PublicFixture surface={surfaceName} />
      ) : surfaceName.startsWith("pk-") ? (
        <PickerFixture surface={surfaceName} />
      ) : surfaceName.startsWith("embed-") ? (
        <EmbedFixture surface={surfaceName} />
      ) : surfaceName.startsWith("act-") ? (
        <ActivityFixture surface={surfaceName} />
      ) : isSettingsProfileFixture(surfaceName) ? (
        <SettingsProfileFixture
          surface={surfaceName}
          shell={
            surfaceName.startsWith("sp-sheet") ? (
              <MobileFixture surface="mobile" />
            ) : (
              <Shell surface="shell" />
            )
          }
        />
      ) : isSearchFixture(surfaceName) ? (
        <SearchFixture
          surface={surfaceName}
          renderShell={(shellSurface) => <Shell surface={shellSurface} />}
        />
      ) : surfaceName === "settings" || surfaceName.startsWith("settings-") ? (
        <SettingsFixture
          tab={
            surfaceName === "settings"
              ? "appearance"
              : surfaceName.replace("settings-", "")
          }
        />
      ) : (
        <Shell surface={surface} />
      );
  }

  return (
    <div className="h-dvh w-full overflow-hidden bg-rm-bg-primary text-rm-text antialiased font-[Figtree,sans-serif]">
      {content}
      <SettingsHost />
    </div>
  );
}
