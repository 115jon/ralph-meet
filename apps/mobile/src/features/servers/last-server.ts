import * as SecureStore from "expo-secure-store";

const KEY = "ralph.last-server";

/** The server the tree showed last, restored on the next launch. */
export function readLastServer(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY).catch(() => null);
}

export function writeLastServer(serverId: string): void {
  SecureStore.setItemAsync(KEY, serverId).catch(() => undefined);
}
