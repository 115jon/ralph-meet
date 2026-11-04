// Rules for remote participants that every client applies the same way.
// See STATE_MACHINE.md, "Remote participants".

/**
 * How long a remote participant's roster row and audio outlive a voice
 * `ClientDisconnect` (op 11) for them. VoiceRoom sends one whenever their
 * voice socket reconnects, before their tracks are offered again, so the
 * drop is cancelled if the same participant id offers tracks within it.
 */
export const REMOTE_RECONNECT_GRACE_MS = 3_000;
