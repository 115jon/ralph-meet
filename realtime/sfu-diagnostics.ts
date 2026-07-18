export type SafeSfuFailureCategory =
  | "client"
  | "network"
  | "server"
  | "timeout";

export interface SafeSfuFailureInput {
  attempt: number;
  operation: string;
  requestId?: string | null;
  status: number | null;
  timedOut?: boolean;
}

export interface SafeSfuFailure {
  attempt: number;
  category: SafeSfuFailureCategory;
  operation: string;
  requestId: string | null;
  status: number | null;
}

export function toSafeSfuFailure(input: SafeSfuFailureInput): SafeSfuFailure {
  return {
    attempt: input.attempt,
    category: getFailureCategory(input.status, input.timedOut === true),
    operation: input.operation,
    requestId: input.requestId ?? null,
    status: input.status,
  };
}

function getFailureCategory(
  status: number | null,
  timedOut: boolean,
): SafeSfuFailureCategory {
  if (timedOut) return "timeout";
  if (status === null) return "network";
  if (status >= 500) return "server";
  return "client";
}
