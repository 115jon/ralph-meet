import { getDesktopToken, getStoredKovaAuthSessionToken } from "@/lib/desktop-auth";
import { KOVA_AUTH_PUBLISHABLE_KEY } from "@/lib/kova-auth-config";
import { apiUrl, isTauri } from "@/lib/platform";

export interface VoiceDisconnectBeaconPayload {
  channelId: string;
  serverId?: string | null;
  gatewaySessionId?: string | null;
  voiceSessionId?: string | null;
}

function getAuthToken(): string | null {
  try {
    return getDesktopToken() ?? getStoredKovaAuthSessionToken();
  } catch {
    return null;
  }
}

export function buildVoiceDisconnectBeaconHeaders(payload: VoiceDisconnectBeaconPayload): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const token = getAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (isTauri() && KOVA_AUTH_PUBLISHABLE_KEY) {
    headers["X-Publishable-Key"] = KOVA_AUTH_PUBLISHABLE_KEY;
  }

  if (payload.gatewaySessionId) {
    headers["X-Gateway-Session-Id"] = payload.gatewaySessionId;
  }

  if (payload.voiceSessionId) {
    headers["X-Voice-Session-Id"] = payload.voiceSessionId;
  }

  return headers;
}

export function sendVoiceDisconnectBeacon(payload: VoiceDisconnectBeaconPayload): boolean {
  if (typeof window === "undefined") return false;
  if (!payload.channelId) return false;
  if (!payload.gatewaySessionId && !payload.voiceSessionId) return false;

  const url = apiUrl(`/api/channels/${payload.channelId}/voice-disconnect`);
  const body = JSON.stringify({
    server_id: payload.serverId ?? null,
    gateway_session_id: payload.gatewaySessionId ?? null,
    voice_session_id: payload.voiceSessionId ?? null,
  });

  const token = getAuthToken();
  const needsExplicitAuthHeaders = !!token || (isTauri() && !!KOVA_AUTH_PUBLISHABLE_KEY);

  if (!needsExplicitAuthHeaders && typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    return navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
  }

  void fetch(url, {
    method: "POST",
    body,
    keepalive: true,
    credentials: "include",
    headers: buildVoiceDisconnectBeaconHeaders(payload),
  });

  return true;
}
