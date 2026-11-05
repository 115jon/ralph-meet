import { Schema } from "effect";

import { eventDecoder } from "@/features/realtime/event-decoder";
import { onDispatch, onGatewayReady } from "@/features/realtime/gateway";

import {
  loadServers,
  loadTree,
  noteRead,
  refreshReadStates,
  setVoiceChannel,
  setVoiceStates,
} from "./actions";
import { VoiceMemberSchema } from "./schema";
import { useServersStore } from "./store";

const VoiceStatesEvent = Schema.Struct({
  voice_states: Schema.Record(Schema.String, Schema.Array(VoiceMemberSchema)),
});
const VoiceChannelEvent = Schema.Struct({
  channel_id: Schema.String,
  members: Schema.Array(VoiceMemberSchema),
});
const ChannelEvent = Schema.Struct({ server_id: Schema.String });
const ReadStateEvent = Schema.Struct({
  channel_id: Schema.String,
  last_read_at: Schema.String,
});

const decodeVoiceStates = eventDecoder(VoiceStatesEvent);
const decodeVoiceChannel = eventDecoder(VoiceChannelEvent);
const decodeChannelEvent = eventDecoder(ChannelEvent);
const decodeReadState = eventDecoder(ReadStateEvent);

function handle(event: string, data: unknown): void {
  switch (event) {
    case "VOICE_CHANNEL_STATES": {
      const d = decodeVoiceStates(data);
      if (d) setVoiceStates(d.voice_states);
      return;
    }
    case "VOICE_CHANNEL_STATE_UPDATE": {
      const d = decodeVoiceChannel(data);
      if (d) setVoiceChannel(d.channel_id, d.members);
      return;
    }
    case "CHANNEL_CREATE":
    case "CHANNEL_UPDATE":
    case "CHANNEL_DELETE": {
      const d = decodeChannelEvent(data);
      if (d && useServersStore.getState().trees[d.server_id]) {
        void loadTree(d.server_id);
      }
      return;
    }
    case "READ_STATE_UPDATE": {
      const d = decodeReadState(data);
      if (d) noteRead(d.channel_id, d.last_read_at);
      return;
    }
    case "USER_SERVERS_UPDATE":
    case "GUILD_UPDATE":
    case "GUILD_DELETE":
      void loadServers();
      return;
    default:
      return;
  }
}

/** Keeps the servers store live; returns the unsubscribe. */
export function startServerEvents(): () => void {
  const offDispatch = onDispatch(handle);
  // A reconnect may have missed events: catch up on unread marks, and on
  // the server list if it never loaded (an app launched offline).
  const offReady = onGatewayReady(() => {
    void refreshReadStates();
    if (useServersStore.getState().status === "error") void loadServers();
  });
  return () => {
    offDispatch();
    offReady();
  };
}
