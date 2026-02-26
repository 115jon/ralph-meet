# Ralph Meet — Architecture Audit

> **Last updated:** 2026-02-13
> **Version:** 0.4.0 — Discord-Style Chat System + Dual Gateway

---

## Table of Contents

1. [Overview](#1-overview)
2. [Technology Stack](#2-technology-stack)
3. [Project Structure](#3-project-structure)
4. [Infrastructure & Deployment](#4-infrastructure--deployment)
5. [Dual Gateway Protocol](#5-dual-gateway-protocol)
6. [WebRTC Architecture](#6-webrtc-architecture)
7. [Server: Main Gateway (`MeetingRoom`)](#7-server-main-gateway-meetingroom)
8. [Server: Voice Gateway (`VoiceRoom`)](#8-server-voice-gateway-voiceroom)
9. [Client: SFU Client (`SFUClient`)](#9-client-sfu-client-sfuclient)
10. [Room Page — State Management](#10-room-page--state-management)
11. [Media Acquisition & Device Management](#11-media-acquisition--device-management)
12. [Mute/Unmute System](#12-muteunmute-system)
13. [Screen Sharing](#13-screen-sharing)
14. [Voice Activity Detection (VAD) & Speaking Indicators](#14-voice-activity-detection-vad--speaking-indicators)
15. [Session Resumption & Replay Buffer](#15-session-resumption--replay-buffer)
16. [Per-User Volume Control](#16-per-user-volume-control)
17. [UI Components (Video)](#17-ui-components-video)
18. [Design System & Styling](#18-design-system--styling)
19. [Data Flow Diagrams](#19-data-flow-diagrams)
20. [Known Limitations & Edge Cases](#20-known-limitations--edge-cases)
21. [Chat System Architecture](#21-chat-system-architecture)
22. [Chat REST API Layer](#22-chat-rest-api-layer)
23. [Chat Gateway Protocol](#23-chat-gateway-protocol)
24. [Chat State Management (`ChatProvider`)](#24-chat-state-management-chatprovider)
25. [Database Schema (D1)](#25-database-schema-d1)
26. [Chat URL Routing](#26-chat-url-routing)
27. [KV Cache Layer](#27-kv-cache-layer)

---

## 1. Overview

Ralph Meet is a real-time communication platform built on **Cloudflare's infrastructure**. It combines **Discord-style text chat** (servers, channels, messages, reactions, presence) with **multi-party video calls** (audio, video, screen sharing), using a **Discord-inspired dual gateway protocol** for signaling.

### Core Capabilities

**Chat System:**
- Discord-style servers with text/voice channels and categories
- Real-time messaging with reactions, typing indicators, and file attachments
- Server member management (roles: owner/admin/moderator/member)
- Invite system with customizable expiry and max uses
- User presence tracking (online/idle/DND/invisible) via WebSocket
- URL-based routing (`/chat/serverId/channelId`) with deep linking
- Real-time broadcasts for member joins/leaves, server updates, role changes

**Video Calls:**
- Multi-party video/audio calls (no hard participant limit)
- Screen sharing with audio
- **Discord-style opcode-based WebSocket protocol**
- **Dual gateway architecture** (Main GW + Voice GW)
- **Voice Activity Detection (VAD)** with speaking indicators (green ring)
- **Session resumption** with sequence-based message replay
- Camera/mic mute with bandwidth-efficient signaling
- Per-user volume control (Web Audio API)
- Live device switching (hot-swap mic/camera)
- Auto-reconnect on connection loss
- Auto-rejoin on page reload
- Responsive grid layout that adapts to participant count
- Avatar tiles for participants without camera

**Shared:**
- Clerk authentication with profile sync
- Cloudflare D1 for persistent storage
- Cloudflare KV for edge caching (cache-aside + write-through invalidation)
- Cloudflare R2 for file/image storage

### Architecture Summary
```
┌─────────────────┐     Main GW (WS)     ┌──────────────────────┐
│   Browser (A)   │◄────────────────────►│  Cloudflare Worker   │
│                 │                       │   (custom-worker.ts) │
│  Next.js App    │     Voice GW (WS)    │          │           │
│  SFUClient      │◄────────────────────►│  MeetingRoom DO      │
│  React UI       │                       │  (presence, state)   │
│                 │     WebRTC (DTLS)     │          │           │
│                 │◄────────────────────►│  VoiceRoom DO        │
└─────────────────┘                       │  (media signaling)   │
                                          │          │           │
┌─────────────────┐                       │  Cloudflare Calls    │
│   Browser (B)   │◄────────────────────►│  (SFU Service)       │
│                 │◄────────────────────►│                      │
│                 │◄────────────────────►│                      │
└─────────────────┘                       └──────────────────────┘
```

**Signaling** flows through two WebSocket connections to separate Cloudflare Durable Objects.
**Media** flows through WebRTC to Cloudflare's Realtime SFU (Selective Forwarding Unit).
The SFU relays media between participants — it does NOT transcode.

---

## 2. Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend Framework** | Next.js (App Router) | 16.1.6 |
| **UI Library** | React | 19.2.3 |
| **Language** | TypeScript | ^5 |
| **Styling** | CSS Modules (vanilla CSS) | — |
| **Font** | Inter (Google Fonts) | 400–800 |
| **Auth** | Clerk | @clerk/nextjs |
| **Edge Runtime** | Cloudflare Workers | wrangler ^4 |
| **Durable Objects** | MeetingRoom, VoiceRoom | — |
| **Database** | Cloudflare D1 (SQLite) | — |
| **Cache** | Cloudflare Workers KV | — |
| **Object Storage** | Cloudflare R2 | — |
| **Media Relay** | Cloudflare Calls (Realtime SFU) | REST API v1 |
| **NAT Traversal** | Cloudflare TURN | Token-based |
| **Build Bridge** | @opennextjs/cloudflare | ^1 |

### Dependencies (package.json)

**Production:**
- `next` 16.1.6
- `react` / `react-dom` 19.2.3
- `@opennextjs/cloudflare` ^1
- `@clerk/nextjs` (authentication)

**Development:**
- TypeScript ^5, wrangler ^4, ESLint ^9

**Zero external runtime dependencies** beyond Next.js, React, and Clerk. All WebRTC, WebSocket, chat, and media handling is implemented from scratch.

---

## 3. Project Structure

```
ralph-meet/
├── custom-worker.ts          # Cloudflare Worker entrypoint (routing)
├── worker/
│   ├── meeting-room.ts       # MeetingRoom DO — Main Gateway (presence, state, chat)
│   ├── voice-room.ts         # VoiceRoom DO — Voice Gateway (media signaling, SFU)
│   └── d1_schema.sql         # D1 database schema (all tables + indexes)
├── src/
│   ├── app/
│   │   ├── layout.tsx        # Root layout (metadata, Inter font, ClerkProvider)
│   │   ├── globals.css       # Design tokens, resets, scrollbar
│   │   ├── page.tsx          # Landing page (create/join room)
│   │   ├── page.module.css   # Landing page styles
│   │   ├── chat/
│   │   │   ├── layout.tsx        # Chat layout (wraps ChatProvider)
│   │   │   ├── chat.module.css   # Chat page layout styles
│   │   │   └── [[...slug]]/
│   │   │       └── page.tsx      # Chat page — URL routing + orchestrator
│   │   ├── room/
│   │   │   └── [slug]/
│   │   │       ├── page.tsx      # Room page — video call orchestrator
│   │   │       └── room.module.css
│   │   └── api/
│   │       ├── auth/sync/            # POST — Clerk user sync
│   │       ├── servers/              # GET (list), POST (create)
│   │       ├── servers/[id]/
│   │       │   ├── settings/         # PATCH (update), DELETE (delete)
│   │       │   ├── channels/         # GET (list), POST (create)
│   │       │   ├── members/          # GET (list)
│   │       │   ├── members/[userId]/ # PATCH (role), DELETE (kick)
│   │       │   └── invites/          # POST (create invite)
│   │       ├── channels/[id]/
│   │       │   ├── messages/         # GET (paginated), POST (send), PATCH (edit), DELETE
│   │       │   ├── messages/upload/  # POST (file upload to R2)
│   │       │   ├── reactions/        # PUT (add), DELETE (remove)
│   │       │   └── typing/           # POST (typing indicator)
│   │       ├── invites/[code]/join/  # POST (join server via invite)
│   │       ├── presence/             # POST (update user status)
│   │       ├── check-username/       # POST (check username availability)
│   │       └── update-profile/       # POST (update display name)
│   ├── components/
│   │   ├── chat/
│   │   │   ├── ChannelSidebar.tsx    # Channel list + server header
│   │   │   ├── ChatArea.tsx          # Message list + input + typing
│   │   │   ├── CreateServerModal.tsx  # Server creation modal
│   │   │   ├── InviteModal.tsx       # Invite link generator
│   │   │   ├── MemberList.tsx        # Right sidebar member list
│   │   │   ├── MessageInput.tsx      # Rich message input (attachments, reply)
│   │   │   ├── MessageItem.tsx       # Single message display (reactions, actions)
│   │   │   ├── ServerList.tsx        # Left server icon strip
│   │   │   ├── ServerSettingsModal.tsx # Server settings + admin panel
│   │   │   ├── UserPanel.tsx         # Bottom user panel + status picker
│   │   │   └── *.module.css          # Matching CSS modules
│   │   ├── JoinForm.tsx              # Pre-join screen (video calls)
│   │   ├── VideoGrid.tsx             # Adaptive grid layout for tiles
│   │   ├── VideoTile.tsx             # Individual participant tile
│   │   ├── MediaControls.tsx         # Bottom control bar
│   │   └── DeviceSelector.tsx        # Mic/camera device picker popup
│   └── lib/
│       ├── sfu-client.ts        # Dual-gateway WebRTC/WebSocket client
│       ├── chat-context.tsx     # Chat state + gateway + REST actions (React context)
│       ├── api-helpers.ts       # Server-side helpers (auth, DB, broadcast)
│       ├── cache.ts             # KV cache layer (cache-aside, invalidation)
│       ├── types.ts             # Opcodes, payloads, shared types
│       └── useMediaDevices.ts   # Device enumeration hook
├── wrangler.toml             # Cloudflare config (bindings, secrets)
├── open-next.config.ts       # OpenNext Cloudflare adapter config
├── next.config.ts            # Next.js config
├── tsconfig.json             # TypeScript config
└── package.json
```

---

## 4. Infrastructure & Deployment

### Custom Worker Entrypoint (`custom-worker.ts`)

The Cloudflare Worker is the main HTTP/WebSocket entrypoint. It routes:

1. **Main Gateway**: `GET /api/room/:slug/ws?v=1` with `Upgrade: websocket` → MeetingRoom DO keyed by slug
2. **Voice Gateway**: `GET /api/room/:slug/voice?v=1` with `Upgrade: websocket` → VoiceRoom DO keyed by slug
3. **Everything else**: Falls through to the OpenNext Next.js handler

```
Request → custom-worker.ts
  ├── /api/room/:slug/ws     → idFromName(slug) → MeetingRoom DO
  ├── /api/room/:slug/voice  → idFromName(slug) → VoiceRoom DO
  └── *                      → nextHandler.fetch(request) → Next.js SSR/Static
```

### Wrangler Configuration (`wrangler.toml`)

```toml
name = "ralph-meet"
main = "./custom-worker.ts"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = ".open-next/assets"
binding = "ASSETS"

[vars]
CALLS_APP_ID = "..."          # Cloudflare Calls application ID
CALLS_APP_SECRET = "..."      # Cloudflare Calls API secret
TURN_TOKEN_ID = "..."         # Cloudflare TURN token ID
TURN_TOKEN_SECRET = "..."     # Cloudflare TURN API secret

[[durable_objects.bindings]]
name = "MEETING_ROOM"
class_name = "MeetingRoom"

[[durable_objects.bindings]]
name = "VOICE_ROOM"
class_name = "VoiceRoom"

[[migrations]]
tag = "v1"
new_classes = ["MeetingRoom"]

[[migrations]]
tag = "v2"
new_classes = ["VoiceRoom"]
```

### Build Pipeline

```bash
npm run build:worker    # npx @opennextjs/cloudflare build
                        # 1. next build (Turbopack)
                        # 2. Bundle into .open-next/worker.js
npm run deploy          # build:worker + npx wrangler deploy
npm run preview         # npx wrangler dev (local preview)
```

---

## 5. Dual Gateway Protocol

The signaling layer is modeled after **Discord's Voice Gateway**, using an opcode-based protocol over two WebSocket connections per participant.

### Why Two Gateways?

| Concern | Main Gateway | Voice Gateway |
|---------|-------------|---------------|
| **Durable Object** | `MeetingRoom` | `VoiceRoom` |
| **URL** | `/api/room/:slug/ws?v=1` | `/api/room/:slug/voice?v=1` |
| **Purpose** | Presence, roster, state | Media signaling, SFU negotiation |
| **Auth** | Clerk token → Identify | Voice token (from Ready) → VoiceIdentify |
| **Messages** | Hello, Identify, Ready, Heartbeat, VoiceStateUpdate, ProfileUpdate | Hello, VoiceIdentify, VoiceReady, SelectProtocol, SessionDescription, Speaking, Video, StopTracks |

This separation mirrors Discord's architecture where the main gateway handles presence/state and the voice gateway handles real-time media. It also allows independent scaling and hibernation of each concern.

### Opcodes (`src/lib/types.ts`)

```typescript
export enum VoiceOpcode {
  // ── Shared opcodes (same number, both gateways) ─────────
  Hello            = 1,   // S→C  Server greeting with heartbeat interval
  Heartbeat        = 3,   // C→S  Keep-alive ping
  HeartbeatACK     = 6,   // S→C  Keep-alive pong with sequence number
  Speaking         = 5,   // C→S→broadcast  VAD voice activity state
  Resumed          = 9,   // S→C  Session successfully resumed
  Error            = 18,  // S→C  Error message

  // ── Main Gateway opcodes ────────────────────────────────
  Identify         = 2,   // C→S  Auth + join (name, Clerk token)
  Ready            = 10,  // S→C  Auth confirmed (participant ID, ICE, roster, voice token)
  Resume           = 7,   // C→S  Resume a previous session
  VoiceStateUpdate = 15,  // Bidirectional: S→C (join/leave/update), C→S (mute/camera state)
  ProfileUpdate    = 16,  // S→C  Broadcast profile changes
  ProfileRefresh   = 17,  // C→S  Request profile re-fetch from Clerk
  ClientDisconnect = 13,  // C→S  Graceful disconnect

  // ── Voice Gateway opcodes ───────────────────────────────
  VoiceIdentify    = 100, // C→S  Auth on voice GW (participant ID + voice token)
  VoiceReady       = 101, // S→C  Voice auth confirmed + existing remote tracks
  SelectProtocol   = 8,   // C→S  SDP offer + track descriptors (push/pull)
  SessionDescription = 4, // S→C  SDP answer/offer from SFU
  Video            = 12,  // S→C  New tracks published by a remote participant
  StopTracks       = 14,  // Bidirectional: C→S (stop my tracks), S→C (tracks stopped)
  Answer           = 11,  // C→S  Client's SDP answer (pull renegotiation)
}
```

### Speaking Flags (Bitfield)

```typescript
export enum SpeakingFlags {
  MICROPHONE = 1 << 0,  // Normal voice activity (VAD detected speech)
  SOUNDSHARE = 1 << 1,  // Screen share / soundshare audio
  PRIORITY   = 1 << 2,  // Priority speaker
  VIDEO      = 1 << 3,  // Camera video active
}
```

### Connection Flow

```
Browser                    Main GW (MeetingRoom)          Voice GW (VoiceRoom)
  │                              │                              │
  │──── WS connect ─────────────►│                              │
  │◄─── Op 1: Hello ────────────│                              │
  │──── Op 2: Identify ────────►│                              │
  │◄─── Op 10: Ready ──────────│  (includes voice_token)       │
  │     (roster, ICE, token)     │                              │
  │                              │                              │
  │──── WS connect ────────────────────────────────────────────►│
  │◄─── Op 1: Hello ──────────────────────────────────────────│
  │──── Op 100: VoiceIdentify ─────────────────────────────────►│
  │◄─── Op 101: VoiceReady ────────────────────────────────────│
  │     (existing remote tracks)  │                              │
  │                              │                              │
  │──── Op 8: SelectProtocol ──────────────────────────────────►│  (push tracks)
  │◄─── Op 4: SessionDescription ─────────────────────────────│  (SFU answer)
  │                              │                              │
  │──── Op 15: VoiceStateUpdate ►│  (mute/camera state)         │
  │◄─── Op 15: VoiceStateUpdate ─│  (broadcast to others)       │
  │                              │                              │
  │──── Op 5: Speaking ────────────────────────────────────────►│  (VAD: talking)
  │◄─── Op 5: Speaking ───────────────────────────────────────│  (broadcast)
  │                              │                              │
  │──── Op 3: Heartbeat ────────►│                              │
  │◄─── Op 6: HeartbeatACK ─────│                              │
  │──── Op 3: Heartbeat ──────────────────────────────────────►│
  │◄─── Op 6: HeartbeatACK ───────────────────────────────────│
```

### Payload Types

#### Client → Server (`ClientMessage`)

| Opcode | Payload | Gateway | Purpose |
|--------|---------|---------|---------|
| `Identify` | `{ name, token? }` | Main | Join room with display name + optional Clerk token |
| `Heartbeat` | `{ seq_ack }` | Both | Keep-alive with last acknowledged sequence |
| `Resume` | `{ session_id, seq_ack }` | Main | Resume a previous session |
| `Speaking` | `{ speaking }` | Voice | VAD speaking state (bitmask) |
| `SelectProtocol` | `{ sdp, push_tracks[], pull_tracks[] }` | Voice | SDP negotiation |
| `Answer` | `{ sdp }` | Voice | Client SDP answer for pull renegotiation |
| `StopTracks` | `{ track_names[] }` | Voice | Stop publishing specific tracks |
| `VoiceStateUpdate` | `{ self_mute?, self_video?, ... }` | Main | Update mute/camera state |
| `ProfileRefresh` | `{}` | Main | Request profile re-fetch from Clerk |
| `ClientDisconnect` | `{}` | Main | Graceful disconnect |
| `VoiceIdentify` | `{ participant_id, voice_token }` | Voice | Auth on voice gateway |

#### Server → Client (`ServerMessage`)

| Opcode | Payload | Gateway | Purpose |
|--------|---------|---------|---------|
| `Hello` | `{ heartbeat_interval, gateway_version? }` | Both | Greeting with heartbeat timing |
| `Ready` | `{ participant_id, ice_servers[], participants[], voice_token, session_id }` | Main | Auth confirmed with full roster |
| `VoiceReady` | `{ participant_id, tracks? }` | Voice | Voice auth confirmed + existing remote tracks |
| `HeartbeatACK` | `{ seq }` | Both | Heartbeat response with sequence |
| `Resumed` | `{ session_id }` | Main | Session resumed successfully |
| `SessionDescription` | `{ sdp, session_id, tracks[], sdp_type }` | Voice | SDP answer/offer from SFU |
| `Speaking` | `{ participant_id, speaking }` | Voice | Broadcast VAD state |
| `VoiceStateUpdate` | `{ participant, action }` | Main | Participant join/leave/update |
| `Video` | `{ participant_id, tracks[] }` | Voice | New tracks available for pulling |
| `StopTracks` | `{ participant_id, track_names[] }` | Voice | Tracks no longer available |
| `ProfileUpdate` | `{ participant_id, name, avatar_url }` | Main | Profile change broadcast |
| `Error` | `{ code, message }` | Both | Error with close code |

### Data Types

```typescript
interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

interface TrackInfo {
  participant_id: string;
  track_name: string;       // e.g. "cam-audio-uuid" or "screen-video-uuid"
  session_id: string;       // SFU session owning this track
  mid?: string;             // SDP media line ID
  kind: "audio" | "video";
}

interface VoiceState {
  id: string;
  name: string;
  avatar_url: string;
  self_mute: boolean;
  self_deaf: boolean;
  self_stream: boolean;
  self_video: boolean;
  suppress: boolean;
  tracks: TrackInfo[];
}
```

---

## 6. WebRTC Architecture

### Two-PeerConnection Design

Each participant maintains **two** separate `RTCPeerConnection` instances, each backed by its own SFU session:

```
Client                          SFU (Cloudflare Calls)
┌─────────────┐
│  pushPC     │ ──sendonly──►  pushSession   (client offers, SFU answers)
│  (publish)  │                   │
└─────────────┘                   │ media relay
┌─────────────┐                   │
│  pullPC     │ ◄──recvonly──  pullSession   (SFU offers, client answers)
│  (receive)  │
└─────────────┘
```

**Why two PeerConnections?**

This eliminates SDP state conflicts. In a single-PC architecture, both the client AND the SFU might try to create offers simultaneously (e.g., client wants to publish while SFU wants to send new remote tracks). This causes `InvalidStateError` when both sides try to set local/remote descriptions concurrently.

With two PCs:
- **pushPC**: Client is ALWAYS the offerer. SFU ALWAYS answers.
- **pullPC**: SFU is ALWAYS the offerer. Client ALWAYS answers.

No contention. This is the same architecture used in Cloudflare's official "Orange Meets" demo.

### Session Lifecycle

1. Client connects Main GW, sends `Identify`
2. Server responds with `Ready` (participant ID, ICE servers, roster, voice token)
3. Client connects Voice GW, sends `VoiceIdentify` with voice token
4. Server responds with `VoiceReady` (includes existing remote tracks from other participants)
5. Client creates both PeerConnections with TURN credentials
6. **Publish flow**: Client adds tracks to pushPC → creates offer → sends via `SelectProtocol` → VoiceRoom forwards to SFU → SFU returns answer → `SessionDescription` sent to client
7. **Pull flow**: Client requests tracks via `SelectProtocol` (empty SDP, pull_tracks populated) → VoiceRoom asks SFU for tracks → SFU generates offer → `SessionDescription` sent as offer → client answers with `Answer` op

### Track Naming Convention

Track names follow the pattern: `{prefix}-{kind}-{participantId}`

- `cam-audio-abc123` — camera microphone audio
- `cam-video-abc123` — camera video
- `screen-video-abc123` — screen share video
- `screen-audio-abc123` — screen share audio

### ICE / TURN

On join, the server generates TURN credentials by calling Cloudflare's TURN API:
```
POST https://rtc.live.cloudflare.com/v1/turn/keys/{tokenId}/credentials/generate-ice-servers
```

Credentials have a 24-hour TTL. The response includes both STUN and TURN URLs. The server limits to 4 entries to avoid Firefox's warning about 5+ ICE servers slowing down discovery.

Fallback: if TURN credentials fail, a plain STUN server (`stun:stun.cloudflare.com:3478`) is used.

---

## 7. Server: Main Gateway (`MeetingRoom`)

**File:** `worker/meeting-room.ts`

The MeetingRoom Durable Object is the authoritative server for room presence and state. Each room slug maps to exactly one DO instance via `idFromName(slug)`.

### Responsibilities
- Participant authentication (Clerk token verification)
- Roster management (join/leave/update)
- Voice state (mute/camera/deaf/stream) tracking
- Voice token generation for Voice GW auth
- Session resumption with message replay
- Profile sync (Clerk profile refresh)
- Heartbeat monitoring

### Hibernation & State Recovery

The DO uses the **WebSocket Hibernation API**, which is critical for cost efficiency:

- When no messages are flowing, the DO hibernates (releases memory/CPU billing)
- On wakeup, the constructor runs again
- All participant state is persisted on WebSocket attachments via `serializeAttachment()` / `deserializeAttachment()`
- The constructor iterates `ctx.getWebSockets()` and rebuilds the `sessions` map from attachments

```typescript
interface WsAttachment {
  id: string;              // Participant UUID
  name: string;            // Display name
  avatar_url: string;      // Profile avatar
  clerk_user_id?: string;  // Clerk user ID (verified users)
  self_mute: boolean;      // Mic mute state
  self_deaf: boolean;      // Deafen state
  self_stream: boolean;    // Screen sharing state
  self_video: boolean;     // Camera on state
  suppress: boolean;       // Suppressed by admin
  tracks: TrackInfo[];     // Currently published tracks
  last_heartbeat: number;  // Last heartbeat timestamp
  seq: number;             // Sequence number
  session_id: string;      // Session ID for resumption
}
```

### Message Handlers

#### `handleIdentify(ws, { name, token? })`
1. Verifies Clerk token (if provided) or accepts as guest
2. Generates a UUID for the participant
3. Generates TURN credentials via Cloudflare API
4. Generates a voice token (`participant_id:room_slug`)
5. Builds roster of existing participants
6. Generates a session ID for resumption
7. Sends `Ready` to the new participant (roster, ICE, voice token, session ID)
8. Broadcasts `VoiceStateUpdate` (action: "join") to everyone else

#### `handleVoiceStateUpdate(ws, { self_mute?, self_video?, ... })`
1. Updates the matching fields on the participant's attachment
2. Persists the updated state
3. Broadcasts `VoiceStateUpdate` (action: "update") with the full `VoiceState` to all other participants

#### `handleResume(ws, { session_id, seq_ack })`
1. Looks up the old attachment by session ID in `resumableSessions` map
2. Re-attaches the old state to the new WebSocket
3. Replays all buffered messages with `seq > seq_ack`
4. Sends `Resumed` confirmation

#### `handleLeave(ws)`
1. Saves session to `resumableSessions` for potential resumption
2. Removes from active sessions map
3. Cleans up replay buffer entries for this participant
4. Broadcasts `VoiceStateUpdate` (action: "leave")
5. Closes the WebSocket

### Replay Buffer

Outgoing broadcast messages are stored in a capped ring buffer (100 entries) with sequence numbers. On resume, messages newer than the client's `seq_ack` are replayed, ensuring no events are missed during brief disconnections.

### SFU API Calls

All SFU communication goes to `https://rtc.live.cloudflare.com/v1/apps/{appId}/...`:

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `sessions/new` | Create a new SFU session |
| `POST` | `sessions/{id}/tracks/new` | Add tracks to a session (push or pull) |
| `PUT` | `sessions/{id}/renegotiate` | Forward a client answer for pull sessions |
| `PUT` | `sessions/{id}/tracks/close` | Close specific tracks on a session |

Authentication: `Authorization: Bearer {CALLS_APP_SECRET}` header.

---

## 8. Server: Voice Gateway (`VoiceRoom`)

**File:** `worker/voice-room.ts`

The VoiceRoom Durable Object handles all media signaling and SFU interaction. It authenticates via voice tokens issued by MeetingRoom.

### Responsibilities
- Voice token authentication
- SFU session management (push/pull)
- SDP negotiation relay (SelectProtocol → SFU → SessionDescription)
- Track lifecycle (publish, pull, stop)
- Speaking state broadcast (VAD)
- Heartbeat monitoring
- Providing existing remote tracks on VoiceReady

### Key State

```typescript
interface VoiceAttachment {
  participant_id: string;        // Linked to MeetingRoom participant
  push_session_id?: string;      // SFU session for publishing
  pull_session_id?: string;      // SFU session for receiving
  tracks: TrackInfo[];           // Currently published tracks
  last_heartbeat: number;
  seq: number;
}
```

### Message Handlers

#### `handleVoiceIdentify(ws, { participant_id, voice_token })`
1. Validates voice token format (`participant_id:room_slug`)
2. Creates a `VoiceAttachment` with empty tracks
3. Collects existing tracks from all other voice participants
4. Sends `VoiceReady` with `participant_id` and `tracks[]` (existing remote tracks)

#### `handleSelectProtocol(ws, { sdp, push_tracks, pull_tracks })`

**Push path** (when `push_tracks.length > 0 && sdp`):
1. Creates a push SFU session if none exists
2. Calls SFU `tracks/new` with the client's offer SDP and track descriptors
3. Records negotiated tracks on the session attachment
4. Sends `SessionDescription` (answer) to the client
5. Broadcasts `Video` (Op 12) to all other voice participants with new track info

**Pull path** (when `pull_tracks.length > 0`):
1. Creates a pull SFU session if none exists
2. Calls SFU `tracks/new` with remote track references
3. Handles partial failures with `pull-retry:` error messages
4. Sends `SessionDescription` (offer) to the client

#### `handleSpeaking(ws, { speaking })`
- Broadcasts `Speaking` with `{ participant_id, speaking }` to all other voice participants
- No state mutation — purely a relay for VAD events

#### `handleStopTracks(ws, { track_names })`
1. Removes tracks from the session attachment
2. Resets push session if all pushed tracks are stopped
3. Broadcasts `StopTracks` to all other voice participants
4. Best-effort closes tracks on the SFU session

---

## 9. Client: SFU Client (`SFUClient`)

**File:** `src/lib/sfu-client.ts`

The SFUClient is a standalone TypeScript class (no React dependency) that manages:
- **Two WebSocket connections** (Main GW + Voice GW)
- Two RTCPeerConnections (push + pull)
- Track publishing, pulling, muting
- Voice Activity Detection (VAD) with speaking broadcast
- Per-user volume control (Web Audio API)
- Event emission to the React layer
- Serialized operation queues
- Reconnection logic
- Session resumption

### Event System

Uses a simple typed event emitter pattern:

```typescript
type SFUEventMap = {
  joined:               { participantId, iceServers, participants }
  "voice-state-update": { participant, action }    // join/leave/update
  "participant-joined":  { participant }
  "participant-left":   { participantId }
  "tracks-published":   { participantId, tracks }
  "tracks-stopped":     { participantId, trackNames }
  speaking:             { participantId, speaking }  // Remote VAD state
  "vad-speaking":       { participantId, isSpeaking }  // Local VAD state
  "remote-track":       { participantId, track, trackInfo }
  "profile-update":     { participantId, name, avatarUrl }
  "connection-state":   { state }
  "push-pc-reset":      void
  error:                { message }
  disconnected:         void
}
```

### Dual Gateway Connection Flow

```
connect(name, token?)
  │
  ├── Create mainWs to /api/room/${slug}/ws?v=1
  │     ├── onmessage → Op 1 Hello → start heartbeat
  │     ├── Send Op 2 Identify { name, token }
  │     ├── Receive Op 10 Ready → emit "joined"
  │     │     ├── Store participantId, sessionId
  │     │     ├── createPeerConnections() with ICE config
  │     │     └── connectVoiceGateway(voice_token)
  │     │           │
  │     │           ├── Create voiceWs to /api/room/${slug}/voice?v=1
  │     │           ├── onmessage → Op 1 Hello → start voice heartbeat
  │     │           ├── Send Op 100 VoiceIdentify { participant_id, voice_token }
  │     │           └── Receive Op 101 VoiceReady
  │     │                 ├── Resolve voiceReadyPromise (unblocks media ops)
  │     │                 ├── Queue any existing remote tracks
  │     │                 └── Pull pending tracks
  │     │
  │     └── onclose → emit disconnected, scheduleReconnect()
  │
  └── acquireMedia() [parallel, non-blocking]
```

### Voice Ready Promise

Media operations (publish, pull) are gated behind a `voiceReadyPromise` that resolves when VoiceReady is received. This ensures no media ops fire before the Voice GW is authenticated, preventing dropped `SelectProtocol` messages.

### Heartbeat System

Dual independent heartbeat loops (one per gateway):

```
Main GW Heartbeat:
  setInterval(heartbeat_interval) →
    if (!lastAckReceived) → missedHeartbeats++
    if (missedHeartbeats >= 3) → reconnect
    Send Op 3 { seq_ack: lastSeq }

Voice GW Heartbeat:
  setInterval(heartbeat_interval) →
    Same pattern, independent counter
```

### Speaking State (VAD → Voice GW)

When VAD detects speaking:
1. `vad-speaking` event emitted locally (for local speaking ring)
2. `sendSpeaking(SpeakingFlags.MICROPHONE)` sent via Voice GW
3. VoiceRoom broadcasts to all other participants
4. Receiving clients get `speaking` event → update remote `isSpeaking`

When VAD detects silence:
1. `vad-speaking` event emitted locally
2. `sendSpeaking(0)` sent via Voice GW

### Mute State (VoiceStateUpdate → Main GW)

```typescript
sendMuteUpdate(isMicOn, isCameraOn)
  → sendMain({ op: VoiceStateUpdate, d: { self_mute: !isMicOn, self_video: isCameraOn } })
  → MeetingRoom broadcasts VoiceStateUpdate (action: "update") to all
```

### Operation Queues

Since both PeerConnections are shared resources, operations on each are serialized:

```typescript
private pushQueue: Promise<void> = Promise.resolve();
private pullQueue: Promise<void> = Promise.resolve();
```

Every `publishTracks()` call chains onto `pushQueue`. Every `pullTracks()` call chains onto `pullQueue`. This prevents concurrent SDP operations on the same PC which would cause `InvalidStateError`.

### Track Publishing (`publishTracks`)

```
publishTracks(stream, prefix)
  │
  ├── Await voiceReadyPromise (gate until Voice GW authenticated)
  ├── For each track in stream:
  │     ├── Generate trackName = "{prefix}-{kind}-{participantId}"
  │     ├── Skip if already published
  │     └── addTransceiver(track, { direction: "sendonly" })
  │
  ├── createOffer() → setLocalDescription()
  ├── Update mids from transceivers
  ├── sendVoice({ op: SelectProtocol, sdp, push_tracks, pull_tracks: [] })
  └── waitForPushAnswer() (resolves when SessionDescription arrives)
```

### Track Pulling (`pullTracks`)

```
pullTracks(tracks)
  │
  ├── Check voiceWs readyState (if not open, queue as pendingPullTracks)
  ├── Store in pulledTracks for mid-matching
  ├── sendVoice({ op: SelectProtocol, sdp: "", push_tracks: [], pull_tracks: tracks })
  └── waitForPullOffer()
        │
        └── (SFU offer arrives as SessionDescription with sdp_type: "offer")
              ├── setRemoteDescription(offer)
              ├── createAnswer()
              ├── setLocalDescription(answer)
              └── sendVoice({ op: Answer, sdp })
```

### Mid-Matching

When `pullPC.ontrack` fires, we match the incoming `MediaStreamTrack` to a specific participant via the **mid** (media line ID):

1. SFU response includes negotiated mids in `SessionDescription`
2. These are stored in `pulledTracks[]` with their `mid` values
3. `ontrack` event provides `event.transceiver.mid`
4. `findTrackByMid(mid)` looks up the TrackInfo → emits `remote-track` with `participantId`

### Track Muting

Audio and video muting use different strategies for bandwidth efficiency:

| Kind | Mute Method | Why |
|------|-------------|-----|
| **Audio** | `track.enabled = false` | Sends silence frames (~20 bytes/packet). Keeps RTP connection warm for instant unmute. |
| **Video** | `sender.replaceTrack(null)` | Stops sending entirely. No black frames, no bandwidth. Original track stored in `mutedVideoTracks`. |

---

## 10. Room Page — State Management

**File:** `src/app/room/[slug]/page.tsx`

This is the main orchestrator component. It manages all state and wires up the SFU client to the React UI.

### State

| State | Type | Initial | Purpose |
|-------|------|---------|---------|
| `joined` | `boolean` | `false` | Whether the user has successfully joined the room |
| `isMicOn` | `boolean` | `false` | Local mic enabled state |
| `isCameraOn` | `boolean` | `false` | Local camera enabled state |
| `isScreenSharing` | `boolean` | `false` | Screen share active |
| `streams` | `StreamEntry[]` | `[]` | All video tiles (local + remote) |
| `connectionState` | `string` | `"new"` | WebRTC connection state |
| `participantCount` | `number` | `0` | Total participants in room |
| `selectedAudioId` | `string` | `""` | Currently selected audio device |
| `selectedVideoId` | `string` | `""` | Currently selected video device |

### StreamEntry Interface

```typescript
interface StreamEntry {
  id: string;              // e.g. "local-camera-uuid" or "remote-camera-uuid"
  name: string;            // Display name
  avatarUrl?: string;      // Avatar URL
  stream: MediaStream | null;  // null = avatar-only tile
  isLocal: boolean;
  isScreenShare: boolean;
  isMuted: boolean;        // Mic muted
  isCameraOff?: boolean;   // Camera off (shows avatar)
  isSpeaking?: boolean;    // VAD speaking ring
}
```

### Stream ID Convention

| ID Pattern | Meaning |
|-----------|---------|
| `local-camera-{myId}` | Local camera/mic tile |
| `local-screen-{myId}` | Local screen share tile |
| `remote-camera-{participantId}` | Remote participant camera tile |
| `remote-screen-{participantId}` | Remote participant screen share tile |

### Event Handler Mapping

| SFU Event | Handler Action |
|-----------|---------------|
| `joined` | Set joined state, create avatar tiles for roster, publish local tracks |
| `participant-joined` | Add avatar tile (`stream: null, isCameraOff: true`) |
| `participant-left` | Remove all tiles for that participant |
| `voice-state-update` (update) | Update `isMuted` / `isCameraOff` on remote tile |
| `speaking` | Update `isSpeaking` on remote tile (VAD ring) |
| `vad-speaking` | Update `isSpeaking` on local tile (VAD ring) |
| `remote-track` | Attach `MediaStream` to existing tile, set `isCameraOff: false` if video |
| `tracks-published` | Update participant track info |
| `tracks-stopped` | Remove screen share tile if screen tracks stopped |
| `profile-update` | Update name and avatar on participant tiles |
| `push-pc-reset` | Re-publish camera tracks on new pushPC |

### The `rebuildStreams` Pattern

`rebuildStreams` reconstructs ALL local stream entries from current state, preserving `isSpeaking` from previous state to prevent VAD flicker:

```typescript
const rebuildStreams = useCallback(() => {
  setStreams((prev) => {
    const entries: StreamEntry[] = [];
    if (joined) {
      const prevLocal = prev.find(s => s.id === localId);
      entries.push({
        id: `local-camera-${myId}`,
        ...,
        isSpeaking: prevLocal?.isSpeaking,  // Preserve VAD state
      });
    }
    const remotes = prev.filter(s => !s.isLocal);
    return [...entries, ...remotes];
  });
}, [joined, isMicOn, isCameraOn]);
```

**Critical design decision**: Remote entries are NEVER rebuilt — only local entries are. Remote entries are managed by individual event handlers.

---

## 11. Media Acquisition & Device Management

### `useMediaDevices` Hook

**File:** `src/lib/useMediaDevices.ts`

Enumerates available audio/video input devices on mount and listens for changes:

```typescript
const { hasMicrophone, hasCamera, audioInputs, videoInputs } = useMediaDevices();
```

### Media Acquisition Flow (`acquireMedia`)

Runs in parallel with WebSocket connection (non-blocking). Uses a fallback chain:

```
1. Try { audio: constraints, video: 720p/30fps }  (audio + video with bandwidth constraints)
   └── FAIL? ↓
2. Try { audio: constraints, video: false }         (audio only, camera failed)
   └── FAIL? ↓
3. Try { audio: true, video: false }                (basic audio, no constraints)
   └── FAIL? ↓
4. Return null                                      (join as listener, no media)
```

After acquisition:
- `localStreamRef.current` is set
- `isCameraOn` / `isMicOn` are set based on available tracks
- Tracks are published to SFU if already connected
- Mute state is broadcast via `sendMuteUpdate`

---

## 12. Mute/Unmute System

The mute system has three layers:

### Layer 1: Local Media Control

**Mic toggle (`toggleMic`):**
1. `track.enabled = newState` on all audio tracks in local stream
2. `sfuRef.muteTrack("audio")` or `unmuteTrack("audio")`
3. `setIsMicOn(newState)` — updates React state
4. `sfuRef.sendMuteUpdate(newState, isCameraOn)` — sends VoiceStateUpdate via Main GW

**Camera toggle (`toggleCamera`):**
1. `track.enabled = newState` on all video tracks
2. `sfuRef.muteTrack("video")` or `unmuteTrack("video")` — calls `sender.replaceTrack(null)` / `sender.replaceTrack(originalTrack)`
3. `setIsCameraOn(newState)` — updates React state
4. `sfuRef.sendMuteUpdate(isMicOn, newState)` — sends VoiceStateUpdate via Main GW

### Layer 2: SFU Transport

| Track Kind | Mute Method | Effect on Wire |
|-----------|-------------|---------------|
| Audio | `track.enabled = false` | Silence frames (20 bytes/pkt) sent to SFU |
| Video | `replaceTrack(null)` | No RTP packets sent. SFU stops forwarding. |

### Layer 3: Remote Notification

The mute state is communicated via two complementary mechanisms:

1. **VoiceStateUpdate (Op 15)** (reliable, explicit):
   - Client sends `{ op: VoiceStateUpdate, d: { self_mute, self_video } }` via Main GW
   - MeetingRoom **persists** the state on the WebSocket attachment and broadcasts to all
   - Receiving clients handle `voice-state-update` event with `action: "update"`
   - On join, the roster includes each participant's persisted state

2. **WebRTC track events** (fallback):
   - `VideoTile` listens for `mute`, `unmute`, `ended` events on video tracks
   - Updates `videoFlowing` state to show/hide avatar

---

## 13. Screen Sharing

### Start Sharing

```
toggleScreen() [start]
  │
  ├── navigator.mediaDevices.getDisplayMedia({ video: true, audio: { ... } })
  ├── screenStreamRef.current = stream
  ├── setIsScreenSharing(true)
  ├── sfu.publishTracks(stream, "screen")   // prefix = "screen"
  ├── Register stream.getVideoTracks()[0].onended handler
  └── rebuildStreams()
```

### Stop Sharing

```
toggleScreen() [stop]  OR  browser "Stop sharing" button
  │
  ├── Build trackNames = ["screen-video-uuid", "screen-audio-uuid"]
  ├── stream.getTracks().forEach(t => t.stop())
  ├── screenStreamRef.current = null
  ├── setIsScreenSharing(false)
  ├── sfu.stopTracks(trackNames)
  └── rebuildStreams()
```

### Screen Share Persistence on Reconnect

When a participant reloads, existing screen share tracks are preserved because:
1. VoiceRoom tracks published tracks in each `VoiceAttachment`
2. On `VoiceReady`, the VoiceRoom sends all existing tracks from other voice sessions
3. The client queues these as `pendingPullTracks` and pulls them immediately

---

## 14. Voice Activity Detection (VAD) & Speaking Indicators

### How It Works (Discord Model)

VAD is purely local — each client analyzes its own microphone audio and broadcasts the speaking state to others via the Voice GW Speaking opcode.

### Local Detection (`startVAD`)

```typescript
// Creates: AudioContext → MediaStreamSource → AnalyserNode
// Polls every 50ms via setInterval
// Computes RMS of frequency data
// Threshold: 15 (RMS, range 0-255)
// Silence delay: 300ms (debounce before "stopped speaking")
```

### Flow

```
Local mic audio → AudioContext → AnalyserNode → RMS calculation
  │
  ├── RMS >= 15 (speaking):
  │     ├── emit("vad-speaking", { isSpeaking: true })  → local green ring
  │     └── sendSpeaking(SpeakingFlags.MICROPHONE)       → Voice GW broadcast
  │
  └── RMS < 15 for 300ms (silence):
        ├── emit("vad-speaking", { isSpeaking: false })  → remove local ring
        └── sendSpeaking(0)                                → Voice GW broadcast
```

### Remote Speaking Indicators

1. VoiceRoom receives `Speaking` op from participant A
2. VoiceRoom broadcasts `Speaking` to all other voice participants
3. Receiving client's `speaking` event handler checks `speaking > 0`
4. Sets `isSpeaking` on the remote participant's `StreamEntry`
5. `VideoTile` applies `.speaking` CSS class → green glowing ring with pulse animation

### CSS Speaking Ring

```css
.speaking {
  border-color: rgba(34, 197, 94, 0.6);
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.4), 0 0 16px rgba(34, 197, 94, 0.2);
  animation: speakingPulse 1.5s ease-in-out infinite;
}
```

---

## 15. Session Resumption & Replay Buffer

### Protocol

When a client briefly disconnects (network blip), it can resume its session instead of re-joining:

```
Client (reconnects)                    Main GW (MeetingRoom)
  │                                         │
  │──── WS connect ────────────────────────►│
  │◄─── Op 1: Hello ───────────────────────│
  │──── Op 7: Resume { session_id,         │
  │           seq_ack: last_received_seq } ►│
  │◄─── (replayed messages seq > seq_ack) ─│
  │◄─── Op 9: Resumed { session_id } ─────│
```

### Replay Buffer (Server)

MeetingRoom maintains a `replayBuffer` (max 100 entries):

```typescript
private replayBuffer: { seq: number; msg: ServerMessage }[] = [];
```

Every `broadcast()` call stores the message with its sequence number. On resume, all messages with `seq > client_seq_ack` are replayed in order.

### Resumable Sessions

When a client disconnects, their session is saved in `resumableSessions: Map<string, WsAttachment>` keyed by `session_id`. When they reconnect and send `Resume`, the old attachment is restored onto the new WebSocket.

---

## 16. Per-User Volume Control

### Client-Side Implementation

Volume control uses the Web Audio API to adjust individual participant audio levels:

```typescript
// In SFUClient:
private volumeContext: AudioContext | null = null;
private volumeGains: Map<string, GainNode> = new Map();
private volumeLevels: Map<string, number> = new Map();

setParticipantVolume(participantId: string, volume: number)  // 0.0 - 1.0
getParticipantVolume(participantId: string): number
```

Each remote audio track is routed through a `GainNode` before playback, allowing per-user volume adjustment without affecting other participants.

---

## 17. UI Components

### JoinForm (`JoinForm.tsx`)

Pre-join screen with:
- **Camera preview**: Optional "Turn on Camera" button → opens a preview-only MediaStream
- **Name input**: Auto-filled from `sessionStorage` if returning (or from Clerk profile)
- **Room code input**: Pre-filled from URL slug
- **Join button**: Triggers `onJoin(name, room)` → stops preview stream, calls `handleJoin`

### VideoGrid (`VideoGrid.tsx`)

Adaptive CSS Grid layout based on participant count:

| Count | Layout |
|-------|--------|
| 1 | Single centered tile (max-width 960px) |
| 2 | Two tiles side by side |
| 3-4 | 2×2 grid |
| 5+ | Auto-fill responsive grid (min 280px per tile) |
| Screen share | Featured layout (screen fills top, cameras in bottom strip) |

### VideoTile (`VideoTile.tsx`)

Memoized with `React.memo` to prevent unnecessary re-renders.

Features:
- **Video element**: `<video>` with `autoPlay playsInline muted` attributes
- **Avatar**: Gradient circle with initials or profile image (shown when camera off)
- **Speaking ring**: Green glowing border with pulse animation when `isSpeaking`
- **Name tag**: Bottom-left overlay with name + " (You)" for local + 🔇 icon if muted
- **Screen badge**: Top-left "SCREEN" badge for screen share tiles
- **Mirrored**: Local camera is CSS-mirrored (`scaleX(-1)`) for natural selfie view

### MediaControls (`MediaControls.tsx`)

Bottom control bar with:
- **Mic toggle**: Blue (on) / gray (off) with SVG microphone icons
- **Camera toggle**: Blue (on) / gray (off) with SVG camera icons
- **Screen share toggle**: Green (sharing) / blue (idle) with monitor icon
- **Device selector**: Settings gear icon → opens DeviceSelector popup
- **Leave button**: Red "Leave" with door icon

### DeviceSelector (`DeviceSelector.tsx`)

Popup panel triggered by the settings gear button:
- Lists all available microphones and cameras
- Checkmark indicates currently selected device
- Clicking a device calls `onSelectAudio` / `onSelectVideo` → triggers device switch
- Closes on outside click

---

## 18. Design System & Styling

### Design Tokens (`globals.css`)

```css
:root {
  --bg-primary: #0a0a0f;          /* Deep dark background */
  --bg-surface: #12121a;          /* Card/surface background */
  --accent: #3b82f6;              /* Blue accent */
  --accent-hover: #60a5fa;        /* Lighter blue on hover */
  --text-primary: #ffffff;
  --text-muted: rgba(255,255,255,0.45);
  --border: rgba(255,255,255,0.06);
  --radius: 12px;
}
```

### Visual Design Patterns

- **Glassmorphism**: `backdrop-filter: blur(16-24px)` on header, controls, panels
- **Gradient accents**: Primary CTA uses `linear-gradient(135deg, #3b82f6, #6366f1)`
- **Avatar gradient**: `linear-gradient(135deg, #3b82f6, #8b5cf6, #ec4899)` (blue→purple→pink)
- **Subtle borders**: 1px `rgba(255,255,255,0.06)` borders throughout
- **Hover effects**: `translateY(-1px)` lift + box-shadow glow on hover
- **Status colors**: Green (#34d399) for connected/sharing, Red (#f87171) for disconnected/leave
- **Speaking ring**: Green (#22c55e) glow with pulse animation

---

## 19. Data Flow Diagrams

### Join Flow (Dual Gateway)

```
User clicks "Join Room"
  │
  ├─[React]──► handleJoin(name, slug)
  │              ├── Store name in sessionStorage
  │              ├── Create SFUClient(slug)
  │              ├── Register all event handlers
  │              ├── sfu.connect(name, clerkToken)
  │              │     ├── mainWs → /api/room/{slug}/ws?v=1
  │              │     ├── ◄── Op 1: Hello { heartbeat_interval }
  │              │     ├── ──► Op 2: Identify { name, token }
  │              │     └── ◄── Op 10: Ready { participant_id, ice_servers, participants, voice_token }
  │              │
  │              └── acquireMedia() [parallel, non-blocking]
  │
  ├─[SFUClient]► on Ready:
  │              ├── createPeerConnections()
  │              ├── connectVoiceGateway(voice_token)
  │              │     ├── voiceWs → /api/room/{slug}/voice?v=1
  │              │     ├── ◄── Op 1: Hello
  │              │     ├── ──► Op 100: VoiceIdentify { participant_id, voice_token }
  │              │     └── ◄── Op 101: VoiceReady { participant_id, tracks: [...existing] }
  │              │           └── Pull existing remote tracks
  │              └── emit("joined")
  │
  └─[React]───► on "joined":
                 ├── setJoined(true)
                 ├── Create avatar tiles for roster
                 ├── Publish local tracks if available
                 └── Start VAD on mic stream
```

### Camera Mute Flow

```
User clicks Camera button
  │
  ├─[React]──► toggleCamera()
  │              ├── track.enabled = false
  │              ├── sfuRef.muteTrack("video")
  │              │     └── sender.replaceTrack(null)
  │              ├── setIsCameraOn(false)
  │              └── sfuRef.sendMuteUpdate(isMicOn, false)
  │                    └── sendMain({ op: VoiceStateUpdate, d: { self_mute: !isMicOn, self_video: false } })
  │
  ├─[Main GW]──► handleVoiceStateUpdate()
  │              ├── Update session attachment
  │              └── broadcast({ op: VoiceStateUpdate, d: { participant, action: "update" } })
  │
  ├─[SFUClient]► emit("voice-state-update", { participant, action: "update" })
  │
  └─[React]───► on "voice-state-update" (action: "update"):
                 └── setStreams(prev => prev.map(s =>
                       s.id === `remote-camera-${pid}`
                         ? { ...s, isMuted: participant.self_mute, isCameraOff: !participant.self_video }
                         : s
                     ))
```

### Speaking Indicator Flow

```
User starts talking
  │
  ├─[VAD]──────► RMS >= threshold (50ms polling)
  │              ├── emit("vad-speaking", { isSpeaking: true })     → local green ring
  │              └── sendSpeaking(SpeakingFlags.MICROPHONE)          → Voice GW
  │
  ├─[Voice GW]─► handleSpeaking()
  │              └── broadcast({ op: Speaking, d: { participant_id, speaking: 1 } })
  │
  ├─[SFUClient]► emit("speaking", { participantId, speaking: 1 })
  │
  └─[React]───► on "speaking":
                 └── setStreams(prev => prev.map(s =>
                       s.id === `remote-camera-${pid}`
                         ? { ...s, isSpeaking: true }
                         : s
                     ))
                 └── VideoTile renders with .speaking CSS class → green ring
```

---

## 20. Known Limitations & Edge Cases

### Architecture

1. **No simulcast**: The SFU receives a single quality level per track. No adaptive bitrate.
2. **No recording**: No server-side recording or compositing.
3. **No end-to-end encryption**: Media is encrypted in transit (DTLS-SRTP) but decrypted at the SFU.
4. **Single region**: Durable Object runs in one Cloudflare colo. Participants far from that colo experience higher signaling latency.

### WebRTC

5. ~~**Push PC recreation on stop-tracks**~~: ✅ **Fixed.** Camera tracks are re-published via `push-pc-reset` event.
6. ~~**No ICE restart on push failure**~~: ✅ **Fixed.** pushPC now has `iceConnectionState === "failed" → restartIce()`.
7. ~~**10-second SDP timeout**~~: ✅ **Improved.** Both push/pull timeouts emit error events.

### Media

8. **Audio processing disabled**: Echo cancellation, noise suppression, and AGC are all disabled. Users without headphones may cause echo.
9. ~~**No bandwidth adaptation**~~: ✅ **Fixed.** `getUserMedia` requests 720p/30fps ideal constraints.

### State Management

10. **No optimistic UI**: UI updates after state change triggers re-render cycle. Sub-frame fast but not truly instant.
11. ~~**Stale closure in acquireMedia**~~: ✅ **Fixed.** Auto-rebuild `useEffect` handles it.

### Browser Compatibility

12. **WebSocket Hibernation**: Requires Cloudflare Workers with hibernation support.
13. **`getDisplayMedia` audio**: Screen share audio only available in Chromium browsers.
14. **`replaceTrack(null)`**: Universally supported, but receiver-side track `mute` event not reliably fired — hence WebSocket signaling.

### Security

15. **Voice token is simple format**: `participant_id:room_slug` — in production, use HMAC verification.
16. **Display name trust**: Names are self-reported for guest users (Clerk users get verified profiles).

---

## 21. Chat System Architecture

The chat system implements a Discord-style server/channel model with real-time messaging, presence, and member management.

### Architecture Summary

```
┌─────────────────┐     REST API        ┌──────────────────────┐
│   Browser        │───────────────────►│  Cloudflare Worker   │
│                  │                     │   (Next.js API)      │
│  ChatProvider    │     Main GW (WS)   │          │           │
│  (React Context) │◄──────────────────►│  MeetingRoom DO      │
│                  │                     │  (gateway, presence) │
│  Components:     │                     │          │           │
│  - ServerList    │                     │  D1 Database         │
│  - ChannelSidebar│                     │  (SQLite)            │
│  - ChatArea      │                     │          │           │
│  - MemberList    │                     │  R2 Storage          │
│  - MessageItem   │                     │  (attachments)       │
└─────────────────┘                     └──────────────────────┘
```

### Design Pattern: REST for Mutations, WebSocket for Events

Following Discord's architecture:
- **All writes** (create message, add reaction, kick member, etc.) go through **REST API routes**
- REST handlers write to D1, then **broadcast events** to WebSocket clients via the MeetingRoom DO
- The MeetingRoom DO acts as a **fan-out hub** — it doesn't handle business logic, just relays events
- **Reads** (load messages, list members) go through REST API routes directly

This separation means:
- Business logic is in standard Next.js API routes (easier to test, debug)
- Real-time updates are fire-and-forget broadcasts (no request/response over WS)
- The DO stays simple and focused on connection management

### Key Entities

| Entity | Table | Description |
|--------|-------|---------|
| User | `users` | Synced from Clerk on auth, stores username + avatar |
| Server | `servers` | Discord "guild" — has name, icon, owner |
| Channel | `channels` | Text or voice channel within a server |
| Category | `categories` | Channel grouping within a server |
| Message | `messages` | Text message in a channel |
| Reaction | `message_reactions` | Emoji reaction on a message (per-user) |
| Attachment | `attachments` | File attached to a message (stored in R2) |
| Server Member | `server_members` | User membership in a server with role |
| Invite | `invites` | Invite link to a server |

### Roles (Integer Enum)

| Value | Role | Permissions |
|-------|------|------------|
| 0 | Member | Read/write messages, react |
| 1 | Moderator | + kick members |
| 2 | Admin | + manage channels, server settings |
| 3 | Owner | + delete server, transfer ownership |

---

## 22. Chat REST API Layer

### API Routes

| Method | Route | Purpose | Auth | Broadcasts |
|--------|-------|---------|------|------------|
| `GET` | `/api/servers` | List user's servers | ✅ | — |
| `POST` | `/api/servers` | Create server (+ default #general) | ✅ | — |
| `PATCH` | `/api/servers/:id/settings` | Update server name/icon | ✅ Admin+ | `GUILD_UPDATE` |
| `DELETE` | `/api/servers/:id/settings` | Delete server | ✅ Owner | `GUILD_DELETE` |
| `GET` | `/api/servers/:id/channels` | List channels in server | ✅ | — |
| `POST` | `/api/servers/:id/channels` | Create channel | ✅ Admin+ | — |
| `GET` | `/api/servers/:id/members` | List members with user info | ✅ | — |
| `PATCH` | `/api/servers/:id/members/:userId` | Change role | ✅ Admin+ | `GUILD_MEMBER_UPDATE` |
| `DELETE` | `/api/servers/:id/members/:userId` | Kick member | ✅ Mod+ | `GUILD_MEMBER_REMOVE` |
| `POST` | `/api/servers/:id/invites` | Create invite link | ✅ | — |
| `POST` | `/api/invites/:code/join` | Join server via invite | ✅ | `GUILD_MEMBER_ADD` |
| `GET` | `/api/channels/:id/messages` | Get messages (paginated, with reactions) | ✅ | — |
| `POST` | `/api/channels/:id/messages` | Send message | ✅ | `MESSAGE_CREATE` |
| `PATCH` | `/api/channels/:id/messages` | Edit message | ✅ Author | `MESSAGE_UPDATE` |
| `DELETE` | `/api/channels/:id/messages` | Delete message | ✅ Author | `MESSAGE_DELETE` |
| `POST` | `/api/channels/:id/messages/upload` | Upload attachment to R2 | ✅ | — |
| `PUT` | `/api/channels/:id/reactions` | Add reaction | ✅ | `REACTION_ADD` |
| `DELETE` | `/api/channels/:id/reactions` | Remove reaction | ✅ | `REACTION_REMOVE` |
| `POST` | `/api/channels/:id/typing` | Send typing indicator | ✅ | `TYPING_START` |
| `POST` | `/api/presence` | Update user status | ✅ | `PRESENCE_UPDATE` |
| `POST` | `/api/auth/sync` | Sync user from Clerk to D1 | ✅ | — |

### Broadcast Helpers (`api-helpers.ts`)

```typescript
// Broadcast to specific channel subscribers
async function broadcastToChannel(channelId: string, event: string, data: unknown)
// Broadcast to ALL connected WebSocket clients (server-wide events)
async function broadcastToAll(event: string, data: unknown)
```

Both hit the MeetingRoom DO's internal `/broadcast` endpoint, which dispatches events as `op: 19` (Dispatch) messages.

### Message Loading with Reactions

The `GET /api/channels/:id/messages` endpoint:
1. Fetches messages with author info (JOIN on `users`)
2. Batch-fetches all reactions for loaded message IDs in a single query
3. Groups reactions by `(message_id, emoji)` with `user_ids[]` arrays
4. Transforms into frontend `Reaction` shape: `{ emoji, count, me, users }`

---

## 23. Chat Gateway Protocol

The chat system reuses the **MeetingRoom DO** as its WebSocket gateway. Chat-specific opcodes extend the existing protocol.

### Chat Opcodes (Extension)

| Opcode | Name | Direction | Purpose |
|--------|------|-----------|--------|
| 0 | Identify | C→S | Auth with `{ name, clerk_user_id }` |
| 2 | Ready | S→C | Server acknowledged Identify |
| 19 | Dispatch | S→C | Event envelope `{ event, data }` |
| 27 | ChannelSubscribe | C→S | Subscribe to channel events `{ channel_id }` |
| 28 | ChannelUnsubscribe | C→S | Unsubscribe from channel `{ channel_id }` |

### Dispatch Events (via op 19)

| Event | Payload | Trigger |
|-------|---------|--------|
| `MESSAGE_CREATE` | Full message object | New message sent |
| `MESSAGE_UPDATE` | Partial message (id, content, updated_at) | Message edited |
| `MESSAGE_DELETE` | `{ id, channel_id }` | Message deleted |
| `REACTION_ADD` | `{ message_id, channel_id, user_id, emoji }` | Reaction added |
| `REACTION_REMOVE` | `{ message_id, channel_id, user_id, emoji }` | Reaction removed |
| `TYPING_START` | `{ channel_id, user_id, username }` | User typing |
| `GUILD_UPDATE` | `{ server_id, name?, icon_url? }` | Server settings changed |
| `GUILD_DELETE` | `{ server_id }` | Server deleted |
| `GUILD_MEMBER_ADD` | `{ server_id, user }` | User joined server |
| `GUILD_MEMBER_REMOVE` | `{ server_id, user_id }` | User kicked/left |
| `GUILD_MEMBER_UPDATE` | `{ server_id, user_id, role }` | Role changed |
| `PRESENCE_UPDATE` | `{ user_id, status }` | User came online/offline/changed status |
| `PRESENCE_LIST` | `{ user_ids[] }` | Online users list (sent on channel subscribe) |

### Gateway Ready Queue

The client queues `ChannelSubscribe`/`ChannelUnsubscribe` messages until the gateway is "ready" (op 2 received). This prevents race conditions where subscribe fires before the server processes Identify.

```typescript
const sendWhenReady = (msg: object) => {
  if (gatewayReadyRef.current) sendGateway(msg);
  else pendingQueue.current.push(msg);
};
// On op 2 Ready: flush pendingQueue
```

### Channel Subscriptions (DO-side)

The MeetingRoom DO maintains a `channelSubscriptions: Map<string, Set<WebSocket>>` that maps channel IDs to connected clients. The `/broadcast` endpoint supports:
- `broadcast_all: false` (default) — send to channel subscribers only
- `broadcast_all: true` — send to ALL connected clients (for server-wide events)

---

## 24. Chat State Management (`ChatProvider`)

**File:** `src/lib/chat-context.tsx`

A React context provider that manages all chat state via `useReducer` and exposes REST mutation functions.

### State Shape

```typescript
interface ChatState {
  user: User | null;              // Current user (from Clerk)
  servers: Server[];              // User's servers
  channels: Channel[];            // Channels for active server
  messages: Message[];            // Messages for active channel
  members: Member[];              // Members for active server
  activeServerId: string | null;  // Currently selected server
  activeChannelId: string | null; // Currently selected channel
  connected: boolean;             // WebSocket connected
  typingUsers: Record<string, Set<string>>; // channelId → usernames
  onlineUsers: Set<string>;       // clerk_user_ids currently online
  status: string;                 // "online" | "idle" | "dnd" | "invisible"
}
```

### Reducer Actions

| Action | Purpose |
|--------|--------|
| `SET_USER` | Set current user from Clerk |
| `SET_SERVERS` | Replace server list |
| `ADD_SERVER` | Append new server |
| `UPDATE_SERVER` | Update server by ID |
| `REMOVE_SERVER` | Remove server by ID |
| `SET_ACTIVE_SERVER` | Switch server (clears channels + messages) |
| `SET_CHANNELS` | Replace channel list for server |
| `ADD_CHANNEL` | Append new channel |
| `SET_ACTIVE_CHANNEL` | Switch channel (clears messages) |
| `SET_MESSAGES` | Replace messages (initial load) |
| `PREPEND_MESSAGES` | Prepend older messages (pagination) |
| `APPEND_MESSAGE` | Add new message (real-time) |
| `UPDATE_MESSAGE` | Edit a message |
| `DELETE_MESSAGE` | Remove a message |
| `ADD_REACTION` | Add reaction to message |
| `REMOVE_REACTION` | Remove reaction from message |
| `SET_MEMBERS` | Replace member list |
| `ADD_MEMBER` | Add member (real-time join) |
| `REMOVE_MEMBER` | Remove member (kick/leave) |
| `UPDATE_MEMBER` | Update member role |
| `SET_CONNECTED` | WebSocket connection state |
| `ADD_TYPING` | Add typing user |
| `REMOVE_TYPING` | Remove typing user |
| `SET_ONLINE_USERS` | Replace online user set |
| `USER_ONLINE` | Add single user to online set |
| `USER_OFFLINE` | Remove single user from online set |
| `SET_STATUS` | Update current user's status |

### REST Mutation Functions

Exposed via context:
- `loadServers()` — fetch user's servers
- `loadChannels(serverId)` — fetch channels
- `loadMembers(serverId)` — fetch members
- `loadMessages(channelId, before?)` — paginated message fetch
- `sendMessage(channelId, content)` — post message
- `editMessage(channelId, messageId, content)` — edit message
- `deleteMessage(channelId, messageId)` — delete message
- `addReaction(channelId, messageId, emoji)` — add reaction
- `removeReaction(channelId, messageId, emoji)` — remove reaction
- `sendTyping(channelId)` — typing indicator
- `createServer(name, iconFile?)` — create server
- `createChannel(serverId, name, type)` — create channel
- `updateStatus(status)` — change presence status
- `subscribeChannel(channelId)` — WS channel subscribe
- `unsubscribeChannel(channelId)` — WS channel unsubscribe

---

## 25. Database Schema (D1)

**File:** `worker/d1_schema.sql`

### Tables

```sql
users (id PK, username, avatar_url, status, created_at)
servers (id PK, name, icon_url, owner_id FK→users)
channels (id PK, server_id FK→servers, category_id, name, channel_type, position)
categories (id PK, server_id FK→servers, name, position)
messages (id PK, channel_id FK→channels, author_id FK→users, content, reply_to_id, is_pinned)
attachments (id PK, message_id FK→messages, filename, url, content_type, size)
message_reactions (message_id + user_id + emoji PK, FK→messages, FK→users)
server_members (server_id + user_id PK, role, nickname, joined_at)
invites (code PK, server_id FK→servers, creator_id FK→users, max_uses, uses, expires_at)
relationships (user_id + target_user_id PK, type)
dm_channels (id PK, created_at)
dm_recipients (channel_id + user_id PK)
```

### Key Indexes

- `idx_messages_created_at` — (channel_id, created_at DESC) for paginated message loading
- `idx_message_reactions_message_id` — fast reaction batch lookup
- `idx_server_members_user_id` — find user's servers
- `idx_channels_server_id` — list channels for a server

---

## 26. Chat URL Routing

The chat page uses a Next.js **optional catch-all route** (`/chat/[[...slug]]`) for URL-based navigation:

| URL | Behavior |
|-----|----------|
| `/chat` | Auto-select first server → first text channel |
| `/chat/:serverId` | Select server → auto-select first text channel |
| `/chat/:serverId/:channelId` | Select exact server + channel |

### URL Sync Strategy

URL updates use `window.history.replaceState` (NOT `router.replace`) to avoid triggering Next.js re-renders:

```typescript
function silentPush(path: string) {
  if (window.location.pathname !== path) {
    window.history.replaceState(null, "", path);
  }
}
```

**Why not `router.replace`?** It triggers a params change → re-triggers URL-restoration effects → dispatches state → triggers URL-sync → infinite render loop.

### Initialization Flow

1. Parse URL slug on mount → store in refs (consumed once)
2. Load servers → pick active server (from URL or first)
3. Load channels + members for active server
4. Auto-select channel (from URL on initial load, or first text channel)
5. Sync URL silently when state changes

---

## 27. KV Cache Layer

**File:** `src/lib/cache.ts`

### Overview

The application uses **Cloudflare Workers KV** as a read-through cache in front of D1 to reduce database query latency and load. KV provides edge-replicated key-value storage with sub-millisecond reads for cached data, while D1 remains the source of truth.

### Strategy

- **Cache-aside (lazy loading)**: Read → check KV → miss → query D1 → populate KV
- **Write-through invalidation**: Mutations DELETE affected cache keys (never eagerly repopulate)
- **Fire-and-forget writes**: KV `put` operations are not awaited in the response path
- **Graceful degradation**: All cache operations are wrapped in try/catch — KV failures never break the app

### What Gets Cached

| Data | Cache Key | TTL | Rationale |
|------|-----------|-----|-----------|
| User's server list | `v1:user:servers:{userId}` | 5min | Hit on every page load |
| Server channels | `v1:server:channels:{serverId}` | 5min | Hit on every server select |
| Server members | `v1:server:members:{serverId}` | 2min | Hit on every server select, changes moderately |
| Server metadata | `v1:server:{serverId}` | 10min | Rarely changes |
| User profile | `v1:user:{userId}` | 10min | Rarely changes |
| Invite lookup | `v1:invite:{code}` | 5min | Read-heavy during invite sharing |

### What Is NOT Cached

| Data | Reason |
|------|--------|
| Messages | High write frequency, cursor-paginated (hard to cache-key), would exhaust 1K writes/day |
| Reactions | Frequent mutations |
| Typing | Ephemeral, broadcast-only, no DB read |
| Presence | Real-time via WebSocket, no DB read |

### Invalidation Matrix

| Mutation | Cache Keys Invalidated |
|----------|----------------------|
| Create server | `user:servers:{userId}` |
| Update server | `server:{id}`, `user:servers:{*members}` |
| Delete server | `server:{id}`, `server:channels:{id}`, `server:members:{id}`, `user:servers:{*members}` |
| Create channel | `server:channels:{serverId}` |
| Member role change | `server:members:{serverId}` |
| Kick member | `server:members:{serverId}`, `user:servers:{kickedUserId}` |
| Join via invite | `server:members:{serverId}`, `user:servers:{userId}`, `invite:{code}` |
| User profile sync (Clerk webhook) | `user:{userId}`, `user:servers:{userId}`, `server:members:{*servers}` |

### Free Tier Budget

| Resource | Free Limit | Expected Usage |
|----------|-----------|----------------|
| KV reads | 100K/day | ~10K/day (well within limit) |
| KV writes | 1K/day | ~100/day (cache sets + invalidation deletes) |
| KV storage | 1GB | <1MB (JSON metadata only) |

### Cache Version

All keys are prefixed with `CACHE_VERSION` (currently `v1`). Bumping this version busts all caches instantly — useful for schema migrations or breaking changes.

### API

```typescript
// Cache-aside: try cache, fall through to D1
const data = await cacheFetch(CacheKey.serverChannels(serverId), CacheTTL.SERVER_CHANNELS, async () => {
  return db.prepare("SELECT ...").bind(serverId).all().then(r => r.results);
});

// Invalidation on write
await cacheDel(CacheKey.serverChannels(serverId));

// Batch invalidation
await cacheDelMany([CacheKey.server(id), CacheKey.serverChannels(id), CacheKey.serverMembers(id)]);
```

