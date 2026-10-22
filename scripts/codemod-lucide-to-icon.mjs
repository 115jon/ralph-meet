#!/usr/bin/env node
/**
 * Codemod: lucide-react (and the chat/Icons.tsx re-exports) -> <Icon>.
 *
 *   node scripts/codemod-lucide-to-icon.mjs [--write] [--json out.json] <files...>
 *
 * Without --write it only reports. It rewrites what is mechanical:
 *   <Mic size={18} className="h-4 w-4 text-x" strokeWidth={2} />
 *     -> <Icon name="mic" size="sm" className="text-x" />
 *   <IconButton icon={X} ... /> -> <IconButton icon="close" ... />
 * and reports everything that needs a person: dynamic sizes, icons passed
 * around as components, responsive size classes, unmapped glyphs.
 *
 * Sizes snap to the scale in src/components/ui/icon/tokens.ts. Concept
 * choices are defaults; review context-dependent ones (a Monitor that means
 * screen share, a Smile that means "add reaction").
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));
const ts = require("typescript");

/** lucide export (or Icons.tsx re-export) -> app concept. */
export const LUCIDE_TO_CONCEPT = {
  AlertCircle: "alert",
  CircleAlert: "alert",
  AlertTriangle: "warning",
  TriangleAlert: "warning",
  AppWindow: "window",
  Archive: "fileArchive",
  ArrowLeft: "back",
  ArrowRight: "arrowRight",
  AtSign: "mention",
  AudioWaveform: "speaking",
  BadgeCheck: "verified",
  Ban: "ban",
  BarChart3: "stats",
  Bell: "bell",
  BellOff: "bellOff",
  BellRing: "bellRinging",
  Calendar: "calendar",
  CalendarPlus: "event",
  Camera: "photo",
  CameraOff: "cameraOff",
  Check: "check",
  CheckIcon: "check",
  CheckCheck: "markRead",
  CheckCircle2: "success",
  ChevronDown: "chevronDown",
  ChevronDownIcon: "chevronDown",
  ChevronLeft: "chevronLeft",
  ChevronRight: "chevronRight",
  ChevronUp: "chevronUp",
  ChevronUpIcon: "chevronUp",
  ChevronsRight: "chevronsRight",
  ClipboardList: "auditLog",
  Clock3: "clock",
  Code2: "fileCode",
  Copy: "copy",
  CopyPlus: "copy",
  CornerUpLeft: "reply",
  Cpu: "cpu",
  Crop: "crop",
  Crown: "crown",
  Delete: "backspace",
  Download: "download",
  Edit2: "edit",
  Pencil: "edit",
  ExternalLink: "externalLink",
  Eye: "eye",
  EyeOff: "eyeOff",
  File: "file",
  FileIcon: "file",
  FileAudio: "fileAudio",
  FileCode2: "fileCode",
  FileDigit: "copyId",
  FileImage: "fileImage",
  FileJson2: "fileData",
  FilePlus: "fileAdd",
  FileSpreadsheet: "fileSpreadsheet",
  FileText: "fileText",
  FileType2: "fileFont",
  FileVideo: "fileVideo",
  FolderPlus: "folderAdd",
  Forward: "forward",
  Gamepad2: "activities",
  Gauge: "gauge",
  Gem: "gem",
  Gif: "gif",
  Gift: "gift",
  Globe: "globe",
  Globe2: "globe",
  GripVertical: "dragHandle",
  Hash: "textChannel",
  HeadphoneOff: "deafen:off",
  Headphones: "deafen",
  Home: "home",
  Image: "image",
  ImageIcon: "image",
  ImageOff: "imageBroken",
  ImagePlus: "image",
  Info: "info",
  Laptop: "laptop",
  LayoutGrid: "grid",
  Lightbulb: "lightbulb",
  Link: "link",
  Link2: "link",
  ListMusic: "playlist",
  ListPlus: "queueAdd",
  Loader2: "loader",
  Lock: "lock",
  LockKeyhole: "lock",
  LogOut: "logout",
  MailOpen: "markUnread",
  Maximize2: "maximize",
  Menu: "menu",
  MessageCircle: "chat",
  MessageSquare: "chat",
  MessageSquareText: "chat",
  Mic: "mic",
  Mic2: "mic",
  MicOff: "mic:off",
  Minimize: "minimize",
  Minimize2: "minimize",
  Minus: "minus",
  Monitor: "monitor",
  MonitorPlay: "stream",
  MonitorX: "streamOff",
  MonitorUp: "screenShare",
  ScreenShare: "screenShare",
  Moon: "moon",
  MoreHorizontal: "more",
  MoreVertical: "moreVertical",
  Move: "move",
  Move3D: "spatial",
  Music: "music",
  Music2: "music",
  Paintbrush: "paintBrush",
  Palette: "appearance",
  Paperclip: "paperclip",
  Pause: "pause",
  Phone: "call",
  PhoneOff: "disconnect",
  Pin: "pin",
  Pipette: "eyedropper",
  Play: "play",
  Plus: "add",
  PlusCircle: "attach",
  Power: "power",
  Presentation: "filePresentation",
  Radio: "soundboard",
  RefreshCw: "refresh",
  Rocket: "activities",
  RotateCcw: "reset",
  Search: "search",
  Send: "send",
  Server: "server",
  Settings: "settings",
  Settings2: "sliders",
  Share2: "share",
  Shield: "shield",
  ShieldCheck: "privacy",
  ShoppingBag: "shop",
  SignalHigh: "signal",
  SkipForward: "skip",
  Slash: "neutral",
  Smartphone: "mobile",
  Smile: "emoji",
  Sparkles: "sparkle",
  Speaker: "speaker",
  Square: "stop",
  Star: "star",
  Sticker: "sticker",
  Sun: "sun",
  Swords: "sword",
  Table2: "fileSpreadsheet",
  Tag: "tag",
  Trash2: "trash",
  TrendingUp: "trendUp",
  Trophy: "trophy",
  Tv: "tv",
  Upload: "upload",
  User: "account",
  UserRound: "account",
  UserCheck: "userCheck",
  UserRoundCheck: "userCheck",
  UserMinus: "userRemove",
  UserPlus: "invite",
  Users: "members",
  Video: "camera",
  VideoOff: "cameraOff",
  Volume2: "voiceChannel",
  VolumeX: "speakerOff",
  WandSparkles: "magic",
  WifiOff: "offline",
  Wind: "noiseSuppression",
  X: "close",
  XIcon: "close",
  XCircle: "error",
  Zap: "zap",
  ZoomIn: "zoomIn",
  ZoomOut: "zoomOut",
};

/** Concepts with a Fill weight (mirror of `fill: true` in mapping.ts). */
const mappingSrc = fs.readFileSync(
  path.join(root, "src/components/ui/icon/mapping.ts"),
  "utf8",
);
const STATEFUL = new Set(
  [...mappingSrc.matchAll(/^\s+(\w+): \{[^}]*fill: true/gm)].map((m) => m[1]),
);

export function pxToToken(px) {
  if (px <= 13) return "xs";
  if (px <= 16) return "sm";
  if (px <= 18) return "md";
  if (px <= 21) return "lg";
  if (px <= 28) return "xl";
  if (px <= 36) return "2xl";
  return "3xl";
}

/** Base (unprefixed) Tailwind sizing classes on an svg. */
const SIZE_CLASS_RE =
  /^(?:size|h|w)-(?:(\d+(?:\.\d+)?)|\[(\d+(?:\.\d+)?)px\])$/;

function classPx(cls) {
  const m = SIZE_CLASS_RE.exec(cls);
  if (!m) return null;
  return m[1] !== undefined ? Number(m[1]) * 4 : Number(m[2]);
}

/** Strip base sizing classes from a class string; report responsive ones. */
function stripSizeClasses(str, glyph) {
  const parts = str.split(/\s+/).filter(Boolean);
  const kept = [];
  let px = null;
  let responsive = false;
  let solid = false;
  for (const p of parts) {
    const v = classPx(p);
    if (v !== null) {
      px = px === null ? v : Math.max(px, v);
      continue;
    }
    if (/^[\w-]+:(?:size|h|w)-/.test(p)) responsive = true;
    // Phosphor glyphs are filled outlines: a fill-* class would paint over
    // them. A solid look is the Fill weight instead.
    if (/^(?:[\w-]+:)?fill-/.test(p)) {
      solid = true;
      continue;
    }
    // Phosphor's push-pin is already drawn on the diagonal.
    if (glyph === "Pin" && p === "rotate-45") continue;
    kept.push(p);
  }
  return { str: kept.join(" "), px, responsive, solid };
}

const DROP_ATTRS = new Set([
  "strokeWidth",
  "absoluteStrokeWidth",
  "aria-hidden",
]);

function isIconSource(spec) {
  return (
    spec === "lucide-react" ||
    (/(^|\/)Icons$/.test(spec) &&
      (spec.startsWith(".") || spec.startsWith("@/")))
  );
}

export function transformFile(file, text) {
  const kind = file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
  const edits = [];
  const notes = [];
  const bindings = new Map();
  const importDecls = [];

  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !isIconSource(st.moduleSpecifier.text))
      continue;
    const nb = st.importClause?.namedBindings;
    if (!nb || !ts.isNamedImports(nb)) continue;
    importDecls.push(st);
    for (const el of nb.elements) {
      bindings.set(el.name.text, {
        imported: (el.propertyName ?? el.name).text,
        el,
        decl: st,
      });
    }
  }
  if (!bindings.size) return { text, notes, changed: false, remaining: [] };

  // A local binding named `Icon` (other than ours) would shadow the import.
  let declaresIcon = false;
  const findIconBinding = (node) => {
    if (ts.isIdentifier(node) && node.text === "Icon") {
      const p = node.parent;
      const isBinding =
        ((ts.isVariableDeclaration(p) ||
          ts.isFunctionDeclaration(p) ||
          ts.isClassDeclaration(p) ||
          ts.isParameter(p) ||
          ts.isBindingElement(p)) &&
          p.name === node) ||
        (ts.isImportSpecifier(p) &&
          !p.parent.parent.parent.moduleSpecifier.text.endsWith(
            "components/ui/icon",
          ));
      if (isBinding) declaresIcon = true;
    }
    ts.forEachChild(node, findIconBinding);
  };
  findIconBinding(sf);
  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const replaced = new Set();

  const visit = (node) => {
    // <Glyph ... />
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      bindings.has(node.tagName.text)
    ) {
      const b = bindings.get(node.tagName.text);
      const concept = LUCIDE_TO_CONCEPT[b.imported];
      const res =
        concept && !declaresIcon
          ? rewriteElement(node, concept, b.imported)
          : null;
      if (!res) {
        notes.push({
          line: line(node),
          kind: concept
            ? declaresIcon
              ? "icon-name-clash"
              : "manual"
            : "unmapped",
          glyph: b.imported,
          text: node.getText(sf).slice(0, 140),
        });
      } else {
        edits.push(res.edit);
        replaced.add(node.tagName);
        if (ts.isJsxOpeningElement(node)) {
          const closing = node.parent.closingElement;
          edits.push({
            start: closing.getStart(sf),
            end: closing.getEnd(),
            text: "</Icon>",
          });
          replaced.add(closing.tagName);
        }
        for (const n of res.notes)
          notes.push({ line: line(node), glyph: b.imported, ...n });
      }
    }
    // icon={Glyph}
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(sf) === "icon" &&
      node.initializer &&
      ts.isJsxExpression(node.initializer) &&
      node.initializer.expression &&
      ts.isIdentifier(node.initializer.expression) &&
      bindings.has(node.initializer.expression.text)
    ) {
      const id = node.initializer.expression;
      const concept = LUCIDE_TO_CONCEPT[bindings.get(id.text).imported];
      if (concept) {
        edits.push({
          start: node.initializer.getStart(sf),
          end: node.initializer.getEnd(),
          text: `"${concept.split(":")[0]}"`,
        });
        replaced.add(id);
      }
    }
    ts.forEachChild(node, visit);
  };

  function rewriteElement(node, concept, glyph) {
    const out = [];
    const localNotes = [];
    let px = null;
    let solidClass = false;
    // "mic:off" -> name mic, state off
    const [baseConcept, presetState] = concept.split(":");
    let state = presetState ?? null;
    for (const attr of node.attributes.properties) {
      if (ts.isJsxSpreadAttribute(attr)) {
        out.push(attr.getText(sf));
        localNotes.push({ kind: "spread", text: attr.getText(sf) });
        continue;
      }
      const name = attr.name.getText(sf);
      const init = attr.initializer;
      if (DROP_ATTRS.has(name)) continue;
      if (name === "size") {
        const lit =
          init &&
          (ts.isStringLiteral(init)
            ? init
            : ts.isJsxExpression(init) &&
                init.expression &&
                ts.isNumericLiteral(init.expression)
              ? init.expression
              : null);
        if (!lit) return null; // dynamic size: leave for a person
        px = Number(lit.text);
        continue;
      }
      if (name === "fill") {
        const v = init?.getText(sf) ?? "";
        if (/currentColor/.test(v) && STATEFUL.has(baseConcept))
          state = "active";
        else localNotes.push({ kind: "fill-dropped", text: attr.getText(sf) });
        continue;
      }
      if (name === "className" && init) {
        if (ts.isStringLiteral(init)) {
          const s = stripSizeClasses(init.text, glyph);
          if (s.responsive)
            localNotes.push({ kind: "responsive-size", text: init.text });
          if (s.px !== null && px === null) px = s.px;
          if (s.solid) solidClass = true;
          if (s.str) out.push(`className="${s.str}"`);
          continue;
        }
        // Expression: strip size classes inside string literals only.
        let exprText = attr.getText(sf);
        const exprStart = attr.getStart(sf);
        const pieces = [];
        const walk = (n) => {
          if (
            (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) &&
            n.parent &&
            !ts.isJsxAttribute(n.parent)
          ) {
            const s = stripSizeClasses(n.text, glyph);
            if (s.responsive)
              localNotes.push({ kind: "responsive-size", text: n.text });
            if (s.solid) localNotes.push({ kind: "fill-class", text: n.text });
            if (s.px !== null) {
              if (px === null) px = s.px;
              const quote = n.getText(sf)[0];
              pieces.push({
                start: n.getStart(sf) - exprStart,
                end: n.getEnd() - exprStart,
                text: quote + s.str + quote,
                px: s.px,
              });
            }
          } else if (ts.isTemplateExpression(n)) {
            localNotes.push({
              kind: "template-class",
              text: n.getText(sf).slice(0, 100),
            });
          }
          ts.forEachChild(n, walk);
        };
        walk(init);
        // Different sizes in different branches: a person picks the tokens.
        if (new Set(pieces.map((p) => p.px)).size > 1) return null;
        for (const p of pieces.sort((a, b) => b.start - a.start)) {
          exprText =
            exprText.slice(0, p.start) + p.text + exprText.slice(p.end);
        }
        out.push(
          exprText
            .replace(/,\s*""\s*(?=[,)])/g, "")
            .replace(/\(\s*""\s*,\s*/g, "("),
        );
        continue;
      }
      out.push(attr.getText(sf));
    }
    if (px === null) {
      localNotes.push({ kind: "no-size", text: "lucide default 24px -> xl" });
      px = 24;
    }
    if (solidClass && !state) {
      if (STATEFUL.has(baseConcept)) state = "active";
      else localNotes.push({ kind: "fill-dropped", text: "fill-* class" });
    }
    const attrs = [`name="${baseConcept}"`];
    if (state) attrs.push(`state="${state}"`);
    attrs.push(`size="${pxToToken(px)}"`);
    attrs.push(...out);
    const selfClosing = ts.isJsxSelfClosingElement(node);
    return {
      edit: {
        start: node.getStart(sf),
        end: node.getEnd(),
        text: `<Icon ${attrs.join(" ")}${selfClosing ? " />" : ">"}`,
      },
      notes: localNotes,
    };
  }

  visit(sf);

  // Which bindings are still referenced after the rewrite?
  const stillUsed = new Set();
  const countRefs = (node) => {
    if (
      ts.isIdentifier(node) &&
      bindings.has(node.text) &&
      !replaced.has(node) &&
      !ts.isImportSpecifier(node.parent)
    ) {
      stillUsed.add(node.text);
      if (
        !(
          ts.isJsxSelfClosingElement(node.parent) ||
          ts.isJsxOpeningElement(node.parent) ||
          ts.isJsxClosingElement(node.parent)
        )
      ) {
        notes.push({
          line: line(node),
          kind: "ref",
          glyph: bindings.get(node.text).imported,
          text: node.parent.getText(sf).slice(0, 140),
        });
      }
    }
    ts.forEachChild(node, countRefs);
  };
  for (const st of sf.statements)
    if (!ts.isImportDeclaration(st)) countRefs(st);

  for (const decl of importDecls) {
    const els = decl.importClause.namedBindings.elements;
    const keep = els.filter(
      (el) =>
        stillUsed.has(el.name.text) ||
        (el.isTypeOnly &&
          /Lucide/.test(el.name.text) &&
          text.includes(el.name.text, decl.getEnd())),
    );
    if (keep.length === els.length) continue;
    const start = decl.getFullStart();
    const leading = text.slice(start, decl.getStart(sf));
    if (!keep.length) {
      edits.push({
        start: decl.getStart(sf),
        end:
          decl.getEnd() +
          (text[decl.getEnd()] === "\n"
            ? 1
            : text.slice(decl.getEnd(), decl.getEnd() + 2) === "\r\n"
              ? 2
              : 0),
        text: "",
      });
    } else {
      const spec = decl.moduleSpecifier.getText(sf);
      const names = keep.map((el) => el.getText(sf));
      const one = `import { ${names.join(", ")} } from ${spec};`;
      const body =
        one.length <= 80
          ? one
          : `import {\n${names.map((n) => `  ${n},`).join("\n")}\n} from ${spec};`;
      edits.push({ start: decl.getStart(sf), end: decl.getEnd(), text: body });
    }
    void leading;
  }

  const usesIcon = edits.some((e) => e.text.startsWith("<Icon "));
  const hasIconImport =
    /import\s*\{[^}]*\bIcon\b[^}]*\}\s*from\s*"@\/components\/ui\/icon"/.test(
      text,
    );
  if (usesIcon && !hasIconImport) {
    const anchor = importDecls[0] ?? sf.statements.find(ts.isImportDeclaration);
    edits.push({
      start: anchor.getStart(sf),
      end: anchor.getStart(sf),
      text: `import { Icon } from "@/components/ui/icon";\n`,
    });
  }

  let outText = text;
  for (const e of edits.sort((a, b) => b.start - a.start || b.end - a.end)) {
    outText = outText.slice(0, e.start) + e.text + outText.slice(e.end);
  }
  const remaining = [...stillUsed].map((n) => bindings.get(n).imported);
  return { text: outText, notes, changed: outText !== text, remaining };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const jsonIdx = args.indexOf("--json");
  const jsonOut = jsonIdx >= 0 ? args[jsonIdx + 1] : null;
  const files = args.filter(
    (a, i) => !a.startsWith("--") && (jsonIdx < 0 || i !== jsonIdx + 1),
  );
  const report = [];
  for (const f of files) {
    const abs = path.resolve(f);
    const src = fs.readFileSync(abs, "utf8");
    const res = transformFile(abs, src);
    if (write && res.changed) fs.writeFileSync(abs, res.text);
    report.push({
      file: path.relative(root, abs).split(path.sep).join("/"),
      changed: res.changed,
      remaining: res.remaining,
      notes: res.notes,
    });
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 1));
  for (const r of report) {
    if (!r.notes.length && !r.remaining.length) continue;
    console.log(
      `\n${r.file}${r.remaining.length ? `  [still imports: ${r.remaining.join(", ")}]` : ""}`,
    );
    for (const n of r.notes)
      console.log(
        `  ${n.line}  ${n.kind.padEnd(16)} ${n.glyph ?? ""}  ${String(n.text).replace(/\s+/g, " ")}`,
      );
  }
  console.log(
    `\n${report.filter((r) => r.changed).length}/${report.length} files ${write ? "rewritten" : "would change"}.`,
  );
}
