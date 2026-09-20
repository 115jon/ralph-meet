export function isUnavailableSocialStatus(status: number): boolean {
  return status === 404 || status === 403 || status === 410;
}

export function isTwitterUnavailablePayload(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;

  const record = data as Record<string, unknown>;
  const code = record.code;
  if (code === 404 || code === 403 || code === 410 || code === "404") {
    return true;
  }

  const message = String(record.message ?? record.error ?? "");
  return /not[_ ]found|does not exist|no status found|private[_ ]tweet|tweet (is )?(deleted|unavailable)|status not found/i.test(
    message,
  );
}
