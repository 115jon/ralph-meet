# Branding

`app-icon.png` is the source for the Ralph Meet app icon. Every shipped copy
is generated from it:

```bash
pnpm icons:app                    # from branding/app-icon.png
pnpm icons:app path/to/new.png    # from another file
```

The script (`scripts/generate-app-icons.mjs`) writes:

- `desktop/src-tauri/icons/`: the Tauri bundle PNGs, `icon.icns` and
  `icon.ico`
- `desktop/installer/Assets/icon.ico`
- `public/favicon.ico`

It needs `pnpm install` in `desktop/` (it uses the Tauri CLI to resize).

## Source requirements

- Square PNG with transparency, ideally 1024 px or larger. Windows asks for up
  to 256 px and macOS up to 1024 px. The current file is 486 px because that
  is the largest copy of the current artwork.
- No transparent margin: the artwork should touch the edges of the canvas.
  Windows draws app icons with no plate, and a margin makes the icon look
  smaller than its neighbors on the taskbar.
- Keep detail legible at 16 and 24 px, the title bar and taskbar sizes at 100%
  display scale.

## Not generated

- The mobile apps' icons (`apps/mobile`, `mobile/`). Android adaptive icons
  and iOS icons need their own safe-zone padding.
- `public/favicon-dev.ico` and `favicon-dev.png`, the green dev-server
  variant.
- `desktop/installer/Assets/LogoGeometry.xaml`, the white vector trace that
  the installer window draws.
