export type NormalizedKlipyGeneratedStatusResponse = {
  status: string | null;
  base64Encoded: string | null;
  mimeType: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeKlipyGeneratedStatusResponse(
  payload: unknown,
): NormalizedKlipyGeneratedStatusResponse {
  const root = isRecord(payload) ? payload : {};
  const nestedData = isRecord(root.data) ? root.data : null;
  const source = nestedData ?? root;
  const result = isRecord(source.result) ? source.result : null;

  return {
    status: typeof source.status === "string" ? source.status : null,
    base64Encoded: typeof result?.base64_encoded === "string" ? result.base64_encoded : null,
    mimeType: typeof result?.mime_type === "string" ? result.mime_type : null,
  };
}
