import { apiFetch } from "@/lib/api";

// POST /api/calls/:id/accept and /decline (src/server/routes/calls.ts): the
// callee's answer without the gateway. Accept is idempotent for the callee,
// so the app may confirm a call the native notification already accepted.

/** ok; gone: no longer ringing (answered elsewhere, cancelled, timed out). */
export type CallAnswerResult = "ok" | "gone" | "failed";

export async function answerCall(
  callId: string,
  answer: "accept" | "decline",
): Promise<CallAnswerResult> {
  try {
    const response = await apiFetch(
      `/api/calls/${encodeURIComponent(callId)}/${answer}`,
      { method: "POST" },
    );
    if (response.ok) return "ok";
    return response.status === 404 ? "gone" : "failed";
  } catch {
    return "failed";
  }
}
