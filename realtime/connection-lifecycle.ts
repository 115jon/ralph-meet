export function isSupersededVoiceConnection(
  currentConnectionId: string | null | undefined,
  socketConnectionId: string | null | undefined,
): boolean {
  return Boolean(
    currentConnectionId &&
    socketConnectionId &&
    currentConnectionId !== socketConnectionId,
  );
}

export function isReconnectWithinGrace(
  disconnectedAt: number,
  now: number,
  graceMs: number,
): boolean {
  return now - disconnectedAt < graceMs;
}

export function shouldKeepResumableSession(intentional: boolean): boolean {
  return !intentional;
}
