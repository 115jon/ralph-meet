export function isSupersededVoiceConnection(
  currentConnectionId: string | null | undefined,
  socketConnectionId: string | null | undefined,
): boolean {
  return Boolean(currentConnectionId && socketConnectionId && currentConnectionId !== socketConnectionId);
}

export function isVoiceReconnectWithinGrace(
  disconnectedAt: number,
  now: number,
  graceMs: number,
): boolean {
  return now - disconnectedAt < graceMs;
}
