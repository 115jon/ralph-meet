# Call admission: one request per join

A voice join opens two sockets: the room socket (`MeetingRoom`,
`/api/channels/:slug/ws`) and the voice socket (`VoiceRoom`,
`/api/channels/:slug/voice`). Each needs a single-use ticket, and the
participant needs a voice token and TURN servers. All of them come from one
`POST /api/voice/admission`, which checks the caller's Kova session once and
the channel's access once. This document is the contract; native clients
build from it. Code: `src/server/routes/voice-admission.ts` (endpoint),
`src/server/routes/socket-admission.ts` (the checks), `realtime/voice-media.ts`
(the only place voice tokens and TURN are minted), and the clients
`src/lib/voice/voice-admission-client.ts` (web and desktop) and
`apps/mobile/src/features/voice/tickets.ts` (mobile).

The chat socket (`/api/gateway`) is not part of this. It keeps
`POST /api/voice/socket-ticket` with `{"audience":"global"}`.

## Request

`POST /api/voice/admission`, JSON body, authenticated like every API call
(Kova session cookie, or `Authorization: Bearer <token>`; desktop also sends
`X-Publishable-Key`).

| Field           | Type                    | Default            | Meaning                                                                                                                    |
| --------------- | ----------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `channelId`     | string                  | —                  | The voice channel (or DM channel). Omit only for a public demo room.                                                       |
| `serverId`      | string                  | —                  | Optional; must match the channel's server (`403 SERVER_MISMATCH`).                                                         |
| `roomSlug`      | string                  | —                  | `voice-<serverId>-<channelId>`, `dm-call-<a>-<b>`, or a demo room slug. The server derives the slug for server channels.   |
| `sockets`       | `("room" \| "voice")[]` | `["room","voice"]` | Which tickets to issue. Non-empty, no repeats.                                                                             |
| `media`         | boolean                 | `true` if `"room"` | Mint the voice token and TURN for the room ticket's participant. Only with `"room"`.                                       |
| `participantId` | string                  | —                  | Only when `media` is false: the participant the client already is. Binds the voice ticket. 8–200 chars of `[A-Za-z0-9_-]`. |
| `moveGrant`     | string                  | —                  | The grant from a `VoiceMove` frame; stands in for CONNECT in that channel.                                                 |

A body that breaks these rules gets `400 INVALID_ADMISSION` before any
session check.

## Response

`200`, `Cache-Control: no-store`, and `Server-Timing` with `admission`
(Kova + channel checks), `media` (tickets, token, TURN) and `total`, in ms.

```json
{
  "access_mode": "authenticated",
  "room_slug": "voice-<serverId>-<channelId>",
  "expires_at": 1762300000000,
  "participant_id": "<uuid>",
  "room_ticket": "rt1.<payload>.<sig>",
  "voice_ticket": "rt1.<payload>.<sig>",
  "media": {
    "participant_id": "<uuid>",
    "voice_token": "<participant>:<room>:<ms>:<subject>.<sig>",
    "ice_servers": [{ "urls": ["turn:…"], "username": "…", "credential": "…" }]
  }
}
```

- `room_ticket` / `voice_ticket`: present for each socket asked for. Both
  expire at `expires_at` (issue time + 60 s) and are spent on first use.
- `participant_id`: the participant the tickets are for. With `media`, it
  is the room ticket's nonce, the id the room's `Ready` will carry. Without
  it, the `participantId` the client sent (absent if it sent none).
- `media`: present when `media` was true. The same object the deprecated
  `media_bootstrap` was. `ice_servers` falls back to public STUN when TURN is
  not configured.
- Public demo rooms also get `Set-Cookie` for the demo session.

Errors are the socket-ticket route's: `401` (no Kova session; retry once
after refreshing the app token), `503 AUTH_UNAVAILABLE` (Kova could not
answer; `Retry-After: 5`), `403 CONNECT_DENIED`, `403 SERVER_MISMATCH`,
`403 ROOM_NOT_ALLOWED`, `400 SERVER_VOICE_REQUIRED`, `403` channel not
found, `503 REALTIME_TICKET_SECRET_MISSING` / `CALLS_APP_SECRET_MISSING`,
`429` rate limits (120 per minute per client IP, counted per edge isolate; demo rooms 12 per hour per IP,
30 per hour per demo session).

## Ticket claims

Tickets stay opaque to clients. The server adds two claims to the ones the
socket-ticket route already set (`audience`, `roomSlug`, `subject`, `nonce`,
`expiresAt`, `serverId`, `channelId`):

- Room tickets carry `media`: `"issued"` when this response minted the
  credentials for the ticket's nonce, `"held"` when it minted none.
- Voice tickets carry `participant` when the participant is known.

The worker forwards both to the Durable Object as `x-ralph-realtime-media`
and `x-ralph-realtime-bound-participant` (stripped from client requests).

## What the sockets do with them

**Room socket, `media: "issued"`.** Identify (op 0) mints nothing: no
`MediaReady` (op 41), and `Ready` (op 2) has no `voice_token` and no
`ice_servers`. The client already has them from `media`.

**Room socket, `media: "held"`.** `Resumed` (op 9) after a Resume (op 7)
has no `voice_token` and no `ice_servers`: the client keeps the ones it
holds. An Identify on this ticket is a new participant (the ticket's nonce),
so it mints as before: `MediaReady`, then `Ready` with both.

**Room socket, op 40 `RefreshVoiceCredentials`.** Unchanged: replies
`Resumed` with a fresh `voice_token` and `ice_servers`. Clients send it
before the token's hour runs out (web and mobile: 45 minutes after the token
arrived) and when the voice room refuses a token (4004).

**Voice socket, `participant` set.** A `VoiceIdentify` (op 100) naming any
other participant is closed with `1013` (retryable, no Error frame): the
client asks for a voice ticket bound to the participant it is now. The
participant must still hold a join grant from its room (`VoiceRoom` waits for
the MeetingRoom's push, `voice-join-grant.ts`); the ticket alone never admits
anyone to tracks.

## Client flow

1. **Join** (cold, warm standby, channel switch, move): one request,
   `sockets: ["room","voice"]`, `media: true` (plus `moveGrant` after a
   move). Hand `media` to the peer connection and the voice socket, open both
   sockets, identify the room (op 0) and the voice socket (op 100 with
   `media.participant_id` and `media.voice_token`) without waiting for
   `Ready`.
2. **Prefetch**: the same request ahead of a likely join (hovering a voice
   channel, its landing on screen), kept 40 s, used by the next join for that
   room and then dropped. Never carries `moveGrant`.
3. **Room socket reconnect**: `sockets: ["room"]`, `media: false`. Resume
   with the session id; if the room answers 4006 SessionInvalid, Identify on
   the same socket and take the `MediaReady`/`Ready` credentials for the new
   participant.
4. **Voice socket reconnect**: `sockets: ["voice"]`, `media: false`,
   `participantId: <current participant>`.
5. **Standby promotion**: no request. The standby's voice socket was opened
   with the join's voice ticket; promotion is op 15 `promote_standby` plus
   op 100 on that socket.
6. **Credential expiry**: op 40 on the room socket, no HTTP request.

A failed join request is retried per socket (steps 3 and 4).

## Requests per scenario

Kova-checked HTTP requests before the user is in voice:

| Scenario                      | Two-request flow (≤ v3.12.0)          | Admission |
| ----------------------------- | ------------------------------------- | --------- |
| Cold join                     | 2                                     | 1         |
| Warm join (prefetched)        | 0 at click (2 at hover)               | 0 (1)     |
| Standby promotion             | 0 (2 when the standby was created)    | 0 (1)     |
| Channel switch                | 2                                     | 1         |
| Room socket reconnect         | 1 (and a token + TURN Resume ignores) | 1         |
| Voice socket reconnect        | 1                                     | 1         |
| Moved user (VoiceMove → join) | 2                                     | 1         |

Voice tokens minted per cold join: 2 before (the room ticket's bootstrap,
then Identify for `MediaReady` and `Ready`), 1 now; every Resume minted
another, now none. TURN lookups (cached per isolate) went the same way.

## Deprecated: the two-request flow

`POST /api/voice/socket-ticket` with `audience: "room"` (which also returns
`media_bootstrap`) and `audience: "voice"`, and the Identify/Resume minting
for room tickets without a `media` claim, stay for installed desktop builds up
to v3.12.0 and mobile builds up to mobile-v0.5.1. They behave exactly as
before. Delete them after v3.14.0, once the desktop updater and the mobile
minimum version are past those builds (comments in
`src/server/routes/socket-ticket.ts` and `realtime/meeting-room.ts` say the
same).
