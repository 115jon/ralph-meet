const fs = require('fs');
const path = require('path');

const files = [
  "src/components/chat/DMSidebar.tsx",
  "src/hooks/useVoiceChannel.ts",
  "src/components/chat/NotificationBell.tsx",
  "src/components/chat/MessageInput.tsx",
  "src/components/chat/UserProfilePopover.tsx",
  "src/components/chat/ChatPageClient.tsx",
  "src/components/chat/UserPanel.tsx",
  "src/components/chat/UserProfileModal.tsx",
  "src/components/CommandMenu.tsx",
  "src/components/chat/MentionBadge.tsx",
  "src/components/chat/ChatArea.tsx",
  "src/components/chat/ChannelSidebar.tsx",
  "src/components/chat/MessageItem.tsx",
  "src/components/chat/CreateChannelModal.tsx",
  "src/components/chat/MemberList.tsx",
  "src/components/chat/CreateCategoryModal.tsx",
  "src/components/chat/CreateServerModal.tsx",
  "src/components/StreamContextMenu.tsx"
];

let replaced = 0;

for (const f of files) {
  const full = path.join("/home/jon/ralph-meet", f);
  if (fs.existsSync(full)) {
    let content = fs.readFileSync(full, 'utf8');
    if (content.includes("@/lib/chat-context")) {
      content = content.replace(/@\/lib\/chat-context/g, "@/stores/chat-store");
      fs.writeFileSync(full, content);
      replaced++;
    }
  }
}

console.log(`Replaced in ${replaced} files.`);
