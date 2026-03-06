const fs = require('fs');

const filesToPatch = [
  'src/components/voice/VoiceDebugScreen.tsx',
  'src/components/voice/AudioInteractionModal.tsx',
  'src/components/ScreenShareModal.tsx',
  'src/components/RoomSettingsModal.tsx',
  'src/components/DesktopScreenPickerModal.tsx',
  'src/components/chat/UserProfileModal.tsx',
  'src/components/chat/SettingsModal.tsx',
  'src/components/chat/ServerSettingsModal.tsx',
  'src/components/chat/PinModal.tsx',
  'src/components/chat/InviteModal.tsx',
  'src/components/chat/ImageViewerModal.tsx',
  'src/components/chat/CreateServerModal.tsx',
  'src/components/chat/CreateChannelModal.tsx',
  'src/components/chat/CreateCategoryModal.tsx',
  'src/components/chat/ChannelSettingsModal.tsx',
  'src/components/chat/ChannelInviteModal.tsx'
];

let count = 0;

for (const file of filesToPatch) {
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf8');

  // 1. Remove createPortal import
  content = content.replace(/import\s*\{\s*createPortal\s*\}\s*from\s*['"]react-dom['"];?\s*\n?/g, '');

  // 2. Remove the manual Escape key listeners and useBackButton
  const useEffectListeners = [
    // Pattern 1: useEffect const handler (e: KeyboardEvent) => ...
    /useEffect\(\(\) => \{[\s\n]*const handler = \(e: KeyboardEvent\) => \{ if \(e\.key === "Escape"\) [a-zA-Z]+\(\); \};[\r\n\s]+window\.addEventListener\("keydown", handler\);[\r\n\s]+return \(\) => window\.removeEventListener\("keydown", handler\);[\r\n\s]+\}, \[.*?\]\);/g,
    // Pattern 2: the one in SettingsModal (a bit different)
    /useEffect\(\(\) => \{[\s\n]*const handleEsc = \(e: KeyboardEvent\) => \{[\s\n]*if \(e\.key === "Escape"\) onClose\(\);[\s\n]*\};[\s\n]*window\.addEventListener\("keydown", handleEsc\);[\s\n]*return \(\) => window\.removeEventListener\("keydown", handleEsc\);[\s\n]*\}, \[onClose\]\);/g,
  ];

  for (const pat of useEffectListeners) {
    content = content.replace(pat, '');
  }

  // Remove old useBackButton (if we added it)
  content = content.replace(/useBackButton\([\s\n]*useCallback\(\(\) => \{[\s\n]*onClose\(\);[\s\n]*return true;[\s\n]*\}, \[onClose\]\)[\s\n]*\);/g, '');

  // 3. Find "return createPortal(" and wrap with BaseModal instead
  // We'll replace "return createPortal(" with "return (\n    <BaseModal onClose={onClose}>"
  // Also we need to replace ", document.body );" with "    </BaseModal>\n  );"
  // Wait, some use document.body, some don't specify or format it differently.
  const createPortalPattern = /return\s+createPortal\(\s*([\s\S]*?),\s*document\.body\s*\);/g;

  let modified = false;
  content = content.replace(createPortalPattern, (match, innerJSX) => {
    modified = true;
    return `return (\n    <BaseModal onClose={onClose}>\n      ${innerJSX}\n    </BaseModal>\n  );`;
  });

  if (modified) {
    // Add BaseModal import
    const importBaseModal = 'import { BaseModal } from "@/components/ui/BaseModal";\n';
    const importReactRegex = /^import.+?;/m;
    const match = importReactRegex.exec(content);
    if (match) {
      content = content.slice(0, match.index) + importBaseModal + content.slice(match.index);
    } else {
      content = importBaseModal + content;
    }

    // UseBackButton unused cleanup
    content = content.replace(/import\s*\{\s*useBackButton\s*\}\s*from\s*['"]@\/hooks\/useBackButton['"];?\s*\n?/g, '');

    // Remove unused useCallback if no longer used (basic heuristic)
    // Actually it's safer to leave unused imports, or let eslint fix them later via react-doctor

    fs.writeFileSync(file, content);
    count++;
    console.log("Patched: " + file);
  } else {
    console.log("Not modified (createPortal not found?): " + file);
  }
}
console.log("Total refactored: " + count);
