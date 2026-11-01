# `clerk_user_id` → `user_id`

The user id in voice payloads and in Durable Object state used to be called
`clerk_user_id`, a leftover from Clerk. It is now `user_id`. Deploys roll out
gradually, the pipeline rolls back to the previous Worker version when the
production smoke test fails, and old web tabs and mobile builds stay open for a
long time, so the rename ships in two phases.

## Phase 1 (shipped)

Everything reads `user_id`, falling back to `clerk_user_id`. Everything the
Durable Objects send or store carries both names with the same value, so the
previous Worker version and pre-rename clients keep working.

| Where                                                                           | Write                                                                           | Read                                                                                   |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Wire: VoiceState (call socket), voice channel members (chat socket)             | both names (`withLegacyClerkUserId`)                                            | decoders normalize to `user_id` (`normalizeUserIdField`, the rules' `normalize` steps) |
| MeetingRoom storage: WebSocket attachments, `resumableSessions`, `vc:members:*` | both keys (`withLegacyClerkUserId` at each write in `realtime/meeting-room.ts`) | `normalizeStored*` in `realtime/meeting-room-persistence.ts`                           |
| VoiceRoom SQLite: `participants`                                                | both columns                                                                    | `COALESCE(user_id, clerk_user_id)`                                                     |

Clients no longer send a user id in Identify. The room takes it from the ticket
and ignores `clerk_user_id` if an old client sends it.

On start, VoiceRoom adds whichever of the two columns is missing, then copies
`clerk_user_id` into `user_id` wherever they differ. Only the pre-rename
version makes them differ, so the copy also repairs rows it wrote during a
rollback.

## Phase 2: what to remove

Everything is marked `TODO(user-id-rename phase 2)` and keyed to
`LEGACY_CLERK_USER_ID_COMPAT` in `packages/protocol/src/user-id.ts`.

1. The dual send and dual write: `LEGACY_CLERK_USER_ID_COMPAT`,
   `withLegacyClerkUserId`, and every call to it (wire payloads and
   MeetingRoom storage writes).
2. VoiceRoom's write of `participants.clerk_user_id`.
3. The `clerk_user_id` column itself, in a later migration that runs once
   nothing writes it: drop the column, then delete
   `migrateParticipantsUserIdColumns` and `PARTICIPANT_USER_ID_SQL` (reads
   become plain `user_id`).
4. The read fallbacks: `normalizeUserIdField` and its callers (the decoders'
   `normalize` steps on web and mobile, the `normalizeStored*` functions), and
   then `LEGACY_CLERK_USER_ID_FIELD`.
5. The compatibility tests that seed or expect `clerk_user_id`.

Steps 1 and 2 can ship together. Step 3 needs its own, later deploy: the
version from steps 1 and 2 still reads the column through
`PARTICIPANT_USER_ID_SQL`, and its start-up migration adds the column back if
a rollback lands on a table without it. Step 4 can ship with step 3 or later.

## Phase 2: when

All of these must hold:

- **Mobile:** the minimum supported mobile build reads `user_id` (any build
  from phase 1 on). Older builds read only `clerk_user_id` and break without
  the dual send.
- **Web:** no web tab from before phase 1 can still be open (a few days after
  the phase 1 deploy).
- **Rollback window:** the pipeline can no longer roll back to a version
  before phase 1 (the release after phase 1 has shipped and passed its smoke
  test).
- **Old state:** replays and resumable snapshots written before phase 1 have
  expired. They expire with the resume grace period, minutes after the last
  pre-phase-1 instance stopped. VoiceRoom rows of pre-rename participants go
  when those participants leave or are pruned. Only the read fallback needs
  this; the dual write does not.

`git grep -i clerk` after phase 2 should hit only `CHANGELOG.md` and the
wordle word list.
