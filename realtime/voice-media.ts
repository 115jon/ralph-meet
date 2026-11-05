/**
 * A participant's voice credentials: the voice token (VoiceIdentify, the
 * PartyTracks proxy) and the TURN servers for its peer connection. This is
 * the one place they are minted. Callers:
 *
 * - `/api/voice/admission` (src/server/routes/voice-admission.ts), once per
 *   join, for the room ticket's participant;
 * - MeetingRoom op 40 RefreshVoiceCredentials, before the token's hour runs
 *   out;
 * - MeetingRoom Identify and Resume, only for room tickets that did not come
 *   with credentials (SocketTicketMedia), which includes every ticket from
 *   the deprecated `/api/voice/socket-ticket` room audience.
 *
 * See realtime/ADMISSION.md.
 */

import {
  getCachedTurnCredentials,
  type IceServer,
} from "./meeting-room/turn-credentials";
import { issueVoiceToken } from "./voice-token";

export type { IceServer };

export interface VoiceMedia {
  participantId: string;
  voiceToken: string;
  iceServers: IceServer[];
}

/** The wire form: `media` in the admission response, as MediaReady names it. */
export interface VoiceMediaWire {
  participant_id: string;
  voice_token: string;
  ice_servers: IceServer[];
}

export interface MintVoiceMediaInput {
  participantId: string;
  roomSlug: string;
  /** The admitted user (or demo subject) the token is bound to. */
  subject?: string;
  callsSecret: string;
  /** TURN servers; {@link turnServersFrom} for the isolate-cached ones. */
  turn: () => Promise<IceServer[]>;
}

/** Mints the token and fetches TURN in parallel. */
export async function mintVoiceMedia({
  participantId,
  roomSlug,
  subject,
  callsSecret,
  turn,
}: MintVoiceMediaInput): Promise<VoiceMedia> {
  const [voiceToken, iceServers] = await Promise.all([
    issueVoiceToken({ participantId, roomSlug, subject, secret: callsSecret }),
    turn(),
  ]);
  return { participantId, voiceToken, iceServers };
}

interface TurnLog {
  info(message: string): void;
  warn(message: string): void;
}

/** The isolate-cached TURN servers for this deployment's TURN key. */
export function turnServersFrom(
  env: { TURN_TOKEN_ID?: string; TURN_TOKEN_SECRET?: string },
  log: TurnLog,
): () => Promise<IceServer[]> {
  return () =>
    getCachedTurnCredentials({
      tokenId: env.TURN_TOKEN_ID ?? "",
      tokenSecret: env.TURN_TOKEN_SECRET ?? "",
      fetch,
      log,
    });
}

export function voiceMediaWire(media: VoiceMedia): VoiceMediaWire {
  return {
    participant_id: media.participantId,
    voice_token: media.voiceToken,
    ice_servers: media.iceServers,
  };
}
