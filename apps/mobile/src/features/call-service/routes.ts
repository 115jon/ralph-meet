import {
  Bluetooth,
  Ear,
  Headset,
  SpeakerHigh,
  type Icon as PhosphorIcon,
} from "phosphor-react-native";

import {
  type AudioRoute,
  type AudioRouteType,
  useAudioRoutes,
} from "./service";

const ROUTE_ICON: Record<AudioRouteType, PhosphorIcon> = {
  speaker: SpeakerHigh,
  earpiece: Ear,
  bluetooth: Bluetooth,
  wired: Headset,
  unknown: SpeakerHigh,
};

const ROUTE_LABEL: Record<AudioRouteType, string> = {
  speaker: "Speaker",
  earpiece: "Phone",
  bluetooth: "Bluetooth",
  wired: "Wired headset",
  unknown: "Audio device",
};

export function routeIcon(type: AudioRouteType): PhosphorIcon {
  return ROUTE_ICON[type];
}

/** Bluetooth shows the headset's own name; the rest a plain word. */
export function routeLabel(route: AudioRoute): string {
  if (route.type === "bluetooth" && route.name) return route.name;
  return ROUTE_LABEL[route.type];
}

/** The active route, or null without a native call. */
export function useActiveRoute(): AudioRoute | null {
  return useAudioRoutes((s) => s.routes.find((r) => r.active) ?? null);
}
