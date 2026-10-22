/**
 * Dev-only fixture surfaces (see routes/ui-fixtures.tsx). Seeds the chat store
 * with static data and mounts the real components. Nothing here ships.
 */

import ChannelSidebar from "@/components/chat/ChannelSidebar";
import ChatArea from "@/components/chat/ChatArea";
import { ConnectionOverlay } from "@/components/chat/ConnectionOverlay";
import ContextMenu from "@/components/chat/ContextMenu";
import DMSidebar from "@/components/chat/DMSidebar";
import { EmptyChatArea } from "@/components/chat/EmptyChatArea";
import FriendsView from "@/components/chat/FriendsView";
import InviteModal from "@/components/chat/InviteModal";
import ServerList from "@/components/chat/ServerList";
import SettingsModal from "@/components/chat/SettingsModal";
import UserPanel from "@/components/chat/UserPanel";
import { WebAppTitleBar } from "@/components/chat/AppTitleBar";
import { SplashScreen } from "@/components/SplashScreen";
import { VoiceControls } from "@/components/voice/VoiceControls";
import { VoiceGrid } from "@/components/voice/VoiceGrid";
import { VoiceHeader } from "@/components/voice/VoiceHeader";
import { VoiceLanding } from "@/components/voice/VoiceLanding";
import type { GridItem } from "@/components/voice/types";
import type { ChatMember, VoiceChannelMember } from "@/lib/chat-reducer";
import type { Category, Channel, Message, Server, User } from "@/lib/types";
import { useChatStore } from "@/stores/chat-store";
import { useSearch } from "@tanstack/react-router";
import { Check, ChevronUp, Copy, Trash2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

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
    channels,
    channelsByServerId: { "s-1": channels },
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
    dmChannels,
    voiceChannelStates: { "ch-lounge": voiceMembers },
    voiceChannelStartedAt: { "ch-lounge": NOW - 25 * 60_000 },
    channelMentionCounts: { "ch-design": 2 },
    serverMentionCounts: { "s-2": 4 },
    typingUsers: { "ch-general": new Set(["u-grace"]) },
    pinsLoadedByChannelId: { [activeChannelId]: true },
    pinnedMessagesByChannelId: { [activeChannelId]: [messages[3]!] },
    pinnedMessages: [messages[3]!],
    relationships: [
      { user: users.ada!, type: 1, created_at: at(100) },
      { user: users.grace!, type: 1, created_at: at(100) },
      { user: users.linus!, type: 2, created_at: at(10) },
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
        <div className="flex h-full w-[312px] shrink-0 flex-col bg-rm-bg-secondary">
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
            showMembers={!dm}
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
        <div className="flex h-full w-[312px] shrink-0 flex-col bg-rm-bg-secondary">
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
          <FriendsView onMenuClick={() => {}} onSelectDm={() => {}} />
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

/** `live`: mic muted, deafened, camera on and sharing, so every dock state
 * (rest / muted tint / live accent / solid leave) is visible at once. */
function VoiceRoom({ live = false }: { live?: boolean }) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-rm-bg-primary"
      data-app-layout="true"
    >
      <WebAppTitleBar />
      <div className="flex flex-1 overflow-hidden relative">
        <div className="flex h-full w-[312px] shrink-0 flex-col bg-rm-bg-secondary">
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
                  ],
                }}
                localVoiceChannelId="ch-lounge"
                localVoiceConnected
              />
            </div>
          </div>
        </div>
        <div className="chat-main-content relative flex min-w-0 flex-1 flex-col overflow-hidden bg-rm-bg-primary">
          <div className="flex-1 flex flex-col bg-rm-bg-primary relative overflow-hidden group/cinema">
            <VoiceHeader
              channelName="Lounge"
              connectionState="connected"
              joined
              focusedItem={gridItems.find((g) => g.id === focusedId) ?? null}
              currentScreenQuality={undefined}
              sfu={null}
              showTextChat={false}
              onToggleTextChat={() => {}}
            />
            <div className="flex-1 flex flex-col min-h-0 relative">
              <div className="flex-1 relative min-h-0 bg-rm-bg-primary overflow-hidden flex items-center justify-center">
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
              <div className="flex-shrink-0 bg-rm-bg-surface border-t border-rm-border z-20 relative">
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
                  focusedItem={null}
                  setFocusedId={setFocusedId}
                  handleLeave={() => {}}
                  isFullscreen={false}
                  toggleFs={() => {}}
                  showMembers={false}
                  setShowMembers={() => {}}
                  ChevronUp={ChevronUp}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
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
        <div className="flex h-full w-[312px] shrink-0 flex-col bg-rm-bg-secondary">
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
            icon: <Check className="h-4 w-4" />,
            onClick: () => {},
            divider: true,
          },
          {
            label: "Copy Link",
            icon: <Copy className="h-4 w-4" />,
            onClick: () => {},
          },
          {
            label: "Notification Settings",
            subtitle: "All Messages",
            icon: <Check className="h-4 w-4" />,
            onClick: () => {},
            disabled: true,
            divider: true,
          },
          {
            label: "Delete Channel",
            icon: <Trash2 className="h-4 w-4" />,
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

function SettingsFixture({ tab }: { tab?: string }) {
  return (
    <div className="relative h-full w-full bg-rm-bg-primary">
      <Shell surface="shell" />
      <SettingsModal
        open
        onClose={() => {}}
        initialTab={(tab as never) ?? "appearance"}
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

export default function UiFixtures() {
  const { surface, theme } = useSearch({ from: "/ui-fixtures" });
  const { setTheme } = useTheme();
  const [ready, setReady] = useState(false);

  useEffect(() => {
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
    case "voice-landing":
      content = <VoiceLandingFixture />;
      break;
    case "settings":
    case "settings-voice":
    case "settings-account":
    case "settings-notifications":
      content = (
        <SettingsFixture
          tab={
            surfaceName === "settings"
              ? "appearance"
              : surfaceName.replace("settings-", "")
          }
        />
      );
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
    case "mobile":
    case "mobile-sidebar":
      content = <MobileFixture surface={surface} />;
      break;
    default:
      content = <Shell surface={surface} />;
  }

  return (
    <div className="h-dvh w-screen overflow-hidden bg-rm-bg-primary text-rm-text antialiased font-[Figtree,sans-serif]">
      {content}
    </div>
  );
}
