/**
 * Maps file extensions and MIME types to file icon concepts.
 * Used in AttachmentList (upload previews), MemberList files tab,
 * and anywhere else file icons are needed.
 */

import type { IconName } from "@/components/ui/icon";

// Extension → icon name mapping
const EXT_MAP: Record<string, IconName> = {
  // Images
  ".png": "fileImage",
  ".jpg": "fileImage",
  ".jpeg": "fileImage",
  ".gif": "fileImage",
  ".webp": "fileImage",
  ".avif": "fileImage",
  ".bmp": "fileImage",
  ".svg": "fileImage",
  ".ico": "fileImage",
  ".tiff": "fileImage",
  ".tif": "fileImage",
  ".psd": "fileImage",
  ".ai": "fileImage",
  ".sketch": "fileImage",
  ".fig": "fileImage",
  ".xd": "fileImage",

  // Video
  ".mp4": "fileVideo",
  ".webm": "fileVideo",
  ".mov": "fileVideo",
  ".avi": "fileVideo",
  ".mkv": "fileVideo",
  ".flv": "fileVideo",
  ".wmv": "fileVideo",
  ".m4v": "fileVideo",

  // Audio
  ".mp3": "fileAudio",
  ".wav": "fileAudio",
  ".ogg": "fileAudio",
  ".flac": "fileAudio",
  ".aac": "fileAudio",
  ".m4a": "fileAudio",
  ".wma": "fileAudio",
  ".opus": "fileAudio",

  // Documents
  ".pdf": "fileText",
  ".doc": "fileText",
  ".docx": "fileText",
  ".rtf": "fileText",
  ".odt": "fileText",
  ".pages": "fileText",

  // Text / Markdown
  ".txt": "fileText",
  ".md": "fileText",
  ".mdx": "fileText",
  ".log": "fileText",
  ".csv": "fileSpreadsheet",

  // Spreadsheets
  ".xls": "fileSpreadsheet",
  ".xlsx": "fileSpreadsheet",
  ".ods": "fileSpreadsheet",
  ".numbers": "fileSpreadsheet",

  // Presentations
  ".ppt": "filePresentation",
  ".pptx": "filePresentation",
  ".odp": "filePresentation",
  ".key": "filePresentation",

  // Archives
  ".zip": "fileArchive",
  ".rar": "fileArchive",
  ".7z": "fileArchive",
  ".tar": "fileArchive",
  ".gz": "fileArchive",
  ".bz2": "fileArchive",
  ".xz": "fileArchive",
  ".dmg": "fileArchive",
  ".iso": "fileArchive",

  // Code
  ".js": "fileCode",
  ".ts": "fileCode",
  ".jsx": "fileCode",
  ".tsx": "fileCode",
  ".py": "fileCode",
  ".rb": "fileCode",
  ".go": "fileCode",
  ".rs": "fileCode",
  ".java": "fileCode",
  ".kt": "fileCode",
  ".swift": "fileCode",
  ".c": "fileCode",
  ".cpp": "fileCode",
  ".h": "fileCode",
  ".hpp": "fileCode",
  ".cs": "fileCode",
  ".php": "fileCode",
  ".lua": "fileCode",
  ".r": "fileCode",
  ".sh": "fileCode",
  ".bash": "fileCode",
  ".zsh": "fileCode",
  ".ps1": "fileCode",
  ".bat": "fileCode",
  ".cmd": "fileCode",
  ".html": "fileCode",
  ".htm": "fileCode",
  ".css": "fileCode",
  ".scss": "fileCode",
  ".less": "fileCode",
  ".xml": "fileCode",
  ".yaml": "fileCode",
  ".yml": "fileCode",
  ".toml": "fileCode",

  // Data
  ".json": "fileData",
  ".jsonl": "fileData",
  ".sql": "fileCode",
  ".db": "fileCode",
  ".sqlite": "fileCode",

  // Fonts
  ".ttf": "fileFont",
  ".otf": "fileFont",
  ".woff": "fileFont",
  ".woff2": "fileFont",

  // Executables / binaries
  ".exe": "file",
  ".msi": "file",
  ".app": "file",
  ".deb": "file",
  ".rpm": "file",
  ".apk": "file",
  ".ipa": "file",
  ".dll": "file",
  ".so": "file",
  ".dylib": "file",
  ".wasm": "fileCode",
};

// MIME prefix → icon fallback (used when extension is unknown)
const MIME_PREFIX_MAP: Record<string, IconName> = {
  "image/": "fileImage",
  "video/": "fileVideo",
  "audio/": "fileAudio",
  "text/": "fileText",
  "application/pdf": "fileText",
  "application/zip": "fileArchive",
  "application/json": "fileData",
  "application/javascript": "fileCode",
};

// Color class per file category
const CATEGORY_COLORS: Record<string, string> = {
  image: "text-pink-400",
  video: "text-purple-400",
  audio: "text-green-400",
  document: "text-blue-400",
  spreadsheet: "text-emerald-400",
  presentation: "text-orange-400",
  archive: "text-amber-400",
  code: "text-cyan-400",
  data: "text-yellow-400",
  font: "text-indigo-400",
  default: "text-rm-text-muted",
};

const ICON_CATEGORY = new Map<IconName, string>([
  ["fileImage", "image"],
  ["fileVideo", "video"],
  ["fileAudio", "audio"],
  ["fileText", "document"],
  ["fileSpreadsheet", "spreadsheet"],
  ["filePresentation", "presentation"],
  ["fileArchive", "archive"],
  ["fileCode", "code"],
  ["fileData", "data"],
  ["fileFont", "font"],
]);

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filename.slice(lastDot).toLowerCase();
}

/**
 * Get the icon concept and color class for a given file.
 */
export function getFileIcon(
  filename: string,
  contentType?: string,
): { icon: IconName; colorClass: string } {
  const ext = getExtension(filename);

  // Try extension first (most specific)
  let icon: IconName | undefined = EXT_MAP[ext];

  // Fallback to MIME type prefix
  if (!icon && contentType) {
    for (const [prefix, mimeIcon] of Object.entries(MIME_PREFIX_MAP)) {
      if (contentType.startsWith(prefix) || contentType === prefix) {
        icon = mimeIcon;
        break;
      }
    }
  }

  // Ultimate fallback
  if (!icon) icon = "file";

  // Get category color
  const category = ICON_CATEGORY.get(icon) ?? "default";
  const colorClass = CATEGORY_COLORS[category] || CATEGORY_COLORS.default;

  return { icon, colorClass };
}
