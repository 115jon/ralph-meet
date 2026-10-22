import { useSyncExternalStore } from "react";

const subscribeToMounted = () => () => {};
const getClientMounted = () => true;
const getServerMounted = () => false;

export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeToMounted,
    getClientMounted,
    getServerMounted,
  );
}
