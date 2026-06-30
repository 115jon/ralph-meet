export function isSupersededVoiceConnection(
  currentConnectionId: string | null | undefined,
  socketConnectionId: string | null | undefined,
): boolean {
  return Boolean(currentConnectionId && socketConnectionId && currentConnectionId !== socketConnectionId);
}
