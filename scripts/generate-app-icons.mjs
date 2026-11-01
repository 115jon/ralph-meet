#!/usr/bin/env node
/**
 * Regenerates the Ralph Meet app icon everywhere it ships, from one square
 * PNG with transparency (default: branding/app-icon.png, see
 * branding/README.md).
 *
 *   pnpm icons:app                    regenerate from branding/app-icon.png
 *   pnpm icons:app path/to/new.png    regenerate from another source
 *
 * Writes:
 *   desktop/src-tauri/icons/   PNGs, icon.icns and icon.ico (Tauri bundle)
 *   desktop/installer/Assets/icon.ico
 *   public/favicon.ico
 *
 * Resizing is done by the Tauri CLI (`tauri icon`), already a desktop
 * dependency. This script only packs the .ico files, because `tauri icon`
 * writes a fixed six-size .ico and Windows asks for more sizes than that.
 *
 * Not touched: the mobile apps' icons (Android and iOS need their own safe-zone
 * padding), public/favicon-dev.* (a separate green dev variant), and the
 * installer's monochrome LogoGeometry.xaml trace.
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.resolve(root, process.argv[2] ?? "branding/app-icon.png");
const desktopIcons = path.join(root, "desktop/src-tauri/icons");
const tauriCli = path.join(
  root,
  "desktop/node_modules/@tauri-apps/cli/tauri.js",
);

// Every size Windows 11 asks for: 16/20/24/32/40/48/64 for title bars, menus
// and the tray; 24/30/36/48/60/72/96 for the taskbar; up to 256 for Start
// (learn.microsoft.com/windows/apps/design/iconography/app-icon-construction).
// Windows picks an exact match, else scales the next size down.
//
// 32 goes first on purpose: Tauri embeds the first entry as the default window
// icon, and the tray and its unread badge are drawn from it. The main window
// gets a 256 px icon at runtime instead (desktop/src-tauri/src/lib.rs).
const WINDOWS_ICO_SIZES = [
  32, 16, 20, 24, 30, 36, 40, 48, 60, 64, 72, 80, 96, 256,
];
const FAVICON_SIZES = [16, 32, 48];

// `tauri icon` outputs the desktop bundle uses. It also writes android/, ios/
// and a six-size icon.ico, which are skipped.
const TAURI_OUTPUTS = [
  "32x32.png",
  "64x64.png",
  "128x128.png",
  "128x128@2x.png",
  "icon.png",
  "icon.icns",
  "Square30x30Logo.png",
  "Square44x44Logo.png",
  "Square71x71Logo.png",
  "Square89x89Logo.png",
  "Square107x107Logo.png",
  "Square142x142Logo.png",
  "Square150x150Logo.png",
  "Square284x284Logo.png",
  "Square310x310Logo.png",
  "StoreLogo.png",
];

function readPngSize(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("not a PNG file");
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** An .ico holding the given PNGs as-is (PNG entries, Windows Vista+). */
function packIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);

  const entries = [];
  let offset = header.length + pngs.length * 16;
  for (const png of pngs) {
    const { width, height } = readPngSize(png);
    const entry = Buffer.alloc(16);
    entry.writeUInt8(width >= 256 ? 0 : width, 0); // 0 means 256
    entry.writeUInt8(height >= 256 ? 0 : height, 1);
    entry.writeUInt8(0, 2); // no palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...pngs]);
}

function runTauriIcon(args) {
  execFileSync(process.execPath, [tauriCli, "icon", ...args], {
    cwd: path.join(root, "desktop"),
    stdio: ["ignore", "ignore", "inherit"],
  });
}

if (!existsSync(source)) {
  throw new Error(`Icon source not found: ${source}`);
}
const sourceSize = readPngSize(readFileSync(source));
if (sourceSize.width !== sourceSize.height) {
  throw new Error(
    `Icon source must be square (got ${sourceSize.width}x${sourceSize.height}).`,
  );
}
if (!existsSync(tauriCli)) {
  throw new Error("Tauri CLI missing: run pnpm install in desktop/ first.");
}

const work = mkdtempSync(path.join(tmpdir(), "ralph-app-icons-"));
try {
  const bundleDir = path.join(work, "bundle");
  const sizesDir = path.join(work, "sizes");
  runTauriIcon([source, "--output", bundleDir]);
  const allSizes = [...new Set([...WINDOWS_ICO_SIZES, ...FAVICON_SIZES])];
  runTauriIcon([source, "--output", sizesDir, "--png", allSizes.join(",")]);

  for (const name of TAURI_OUTPUTS) {
    copyFileSync(path.join(bundleDir, name), path.join(desktopIcons, name));
  }

  const png = (size) =>
    readFileSync(path.join(sizesDir, `${size}x${size}.png`));
  const appIco = packIco(WINDOWS_ICO_SIZES.map(png));
  writeFileSync(path.join(desktopIcons, "icon.ico"), appIco);
  writeFileSync(path.join(root, "desktop/installer/Assets/icon.ico"), appIco);
  writeFileSync(
    path.join(root, "public/favicon.ico"),
    packIco(FAVICON_SIZES.map(png)),
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.info(
  `App icons regenerated from ${path.relative(root, source)} ` +
    `(${sourceSize.width}px source).`,
);
