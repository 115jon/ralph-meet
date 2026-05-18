# Ralph Meet Desktop (Tauri)

Desktop client for Ralph Meet built with [Tauri 2.0](https://tauri.app/).

## Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Node.js](https://nodejs.org/) (20+)
- Platform-specific dependencies — see [Tauri prerequisites](https://tauri.app/start/prerequisites/)

## Development

1. **Start the web dev server** (from the project root):
   ```bash
   npm run dev
   ```

2. **Start Tauri** (from `desktop/`):
   ```bash
   npm install
   npm run dev
   ```

The Tauri window loads from `http://localhost:1420`, and the desktop Vite
server proxies `/api` and `/ws` to `http://localhost:5173`.

To run the desktop shell against the deployed Cloudflare backend:

```bash
npm run dev:deployed
```

That mode uses the `deployed` Vite env file and points the desktop proxy at
`https://meet.115jon.site`, avoiding the local backend connection-refused loop
when the web Worker dev server is not running.

## Production Build

```bash
npm run build
```

Output: platform-specific installer in `src-tauri/target/release/bundle/`.

## Architecture

The desktop client is a thin Tauri shell wrapping the same React UI as the web app.
All backend communication goes through the deployed Cloudflare Workers API — no server
is embedded in the desktop application.

```
Tauri (system webview)
  └── React SPA (shared src/)
        └── HTTPS/WSS → Cloudflare Workers backend
```
