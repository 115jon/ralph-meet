/**
 * Maps file extensions and MIME types to specific lucide-react icons.
 * Used in AttachmentList (upload previews), MemberList files tab,
 * and anywhere else file icons are needed.
 */

import {
  Archive,
  Code2,
  File,
  FileAudio,
  FileCode2,
  FileImage,
  FileJson2,
  FileSpreadsheet,
  FileText,
  FileType2,
  FileVideo,
  Presentation,
  Table2,
} from "lucide-react";

// Extension → icon name mapping
const EXT_MAP: Record<string, typeof File> = {
  // Images
  ".png": FileImage, ".jpg": FileImage, ".jpeg": FileImage, ".gif": FileImage,
  ".webp": FileImage, ".avif": FileImage, ".bmp": FileImage, ".svg": FileImage,
  ".ico": FileImage, ".tiff": FileImage, ".tif": FileImage, ".psd": FileImage,
  ".ai": FileImage, ".sketch": FileImage, ".fig": FileImage, ".xd": FileImage,

  // Video
  ".mp4": FileVideo, ".webm": FileVideo, ".mov": FileVideo, ".avi": FileVideo,
  ".mkv": FileVideo, ".flv": FileVideo, ".wmv": FileVideo, ".m4v": FileVideo,

  // Audio
  ".mp3": FileAudio, ".wav": FileAudio, ".ogg": FileAudio, ".flac": FileAudio,
  ".aac": FileAudio, ".m4a": FileAudio, ".wma": FileAudio, ".opus": FileAudio,

  // Documents
  ".pdf": FileText, ".doc": FileText, ".docx": FileText, ".rtf": FileText,
  ".odt": FileText, ".pages": FileText,

  // Text / Markdown
  ".txt": FileText, ".md": FileText, ".mdx": FileText, ".log": FileText,
  ".csv": Table2,

  // Spreadsheets
  ".xls": FileSpreadsheet, ".xlsx": FileSpreadsheet, ".ods": FileSpreadsheet,
  ".numbers": FileSpreadsheet,

  // Presentations
  ".ppt": Presentation, ".pptx": Presentation, ".odp": Presentation,
  ".key": Presentation,

  // Archives
  ".zip": Archive, ".rar": Archive, ".7z": Archive, ".tar": Archive,
  ".gz": Archive, ".bz2": Archive, ".xz": Archive, ".dmg": Archive,
  ".iso": Archive,

  // Code
  ".js": FileCode2, ".ts": FileCode2, ".jsx": FileCode2, ".tsx": FileCode2,
  ".py": FileCode2, ".rb": FileCode2, ".go": FileCode2, ".rs": FileCode2,
  ".java": FileCode2, ".kt": FileCode2, ".swift": FileCode2,
  ".c": FileCode2, ".cpp": FileCode2, ".h": FileCode2, ".hpp": FileCode2,
  ".cs": FileCode2, ".php": FileCode2, ".lua": FileCode2, ".r": FileCode2,
  ".sh": FileCode2, ".bash": FileCode2, ".zsh": FileCode2, ".ps1": FileCode2,
  ".bat": FileCode2, ".cmd": FileCode2,
  ".html": Code2, ".htm": Code2, ".css": Code2, ".scss": Code2, ".less": Code2,
  ".xml": Code2, ".yaml": Code2, ".yml": Code2, ".toml": Code2,

  // Data
  ".json": FileJson2, ".jsonl": FileJson2,
  ".sql": FileCode2, ".db": FileCode2, ".sqlite": FileCode2,

  // Fonts
  ".ttf": FileType2, ".otf": FileType2, ".woff": FileType2, ".woff2": FileType2,

  // Executables / binaries
  ".exe": File, ".msi": File, ".app": File, ".deb": File, ".rpm": File,
  ".apk": File, ".ipa": File, ".dll": File, ".so": File, ".dylib": File,
  ".wasm": FileCode2,
};

// MIME prefix → icon fallback (used when extension is unknown)
const MIME_PREFIX_MAP: Record<string, typeof File> = {
  "image/": FileImage,
  "video/": FileVideo,
  "audio/": FileAudio,
  "text/": FileText,
  "application/pdf": FileText,
  "application/zip": Archive,
  "application/json": FileJson2,
  "application/javascript": FileCode2,
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

 
const ICON_CATEGORY = new Map<any, string>([
  [FileImage, "image"],
  [FileVideo, "video"],
  [FileAudio, "audio"],
  [FileText, "document"],
  [FileSpreadsheet, "spreadsheet"],
  [Presentation, "presentation"],
  [Table2, "spreadsheet"],
  [Archive, "archive"],
  [FileCode2, "code"],
  [Code2, "code"],
  [FileJson2, "data"],
  [FileType2, "font"],
]);

function getExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filename.slice(lastDot).toLowerCase();
}

/**
 * Get the icon component and color class for a given file.
 */
export function getFileIcon(filename: string, contentType?: string): { Icon: typeof File; colorClass: string } {
  const ext = getExtension(filename);

  // Try extension first (most specific)
  let Icon = EXT_MAP[ext];

  // Fallback to MIME type prefix
  if (!Icon && contentType) {
    for (const [prefix, icon] of Object.entries(MIME_PREFIX_MAP)) {
      if (contentType.startsWith(prefix) || contentType === prefix) {
        Icon = icon;
        break;
      }
    }
  }

  // Ultimate fallback
  if (!Icon) Icon = File;

  // Get category color
  const category = ICON_CATEGORY.get(Icon) ?? "default";
  const colorClass = CATEGORY_COLORS[category] || CATEGORY_COLORS.default;

  return { Icon, colorClass };
}
