export interface FailedPublisherSessionDecisionInput {
  ownerConnected: boolean;
  hasOnlyTransientErrors: boolean;
}

export interface FailedPublisherSessionDecision {
  evict: boolean;
  reason: "connected-publisher" | "disconnected-publisher";
}

/**
 * Viewer-side pull failures should never globally evict tracks from a
 * publisher that is still connected. A live publisher may be in the middle of
 * renegotiation or pull-session recovery; tearing their tracks out from under
 * every viewer turns a local subscriber glitch into a room-wide outage.
 */
export function decideFailedPublisherSessionEviction(
  input: FailedPublisherSessionDecisionInput,
): FailedPublisherSessionDecision {
  if (input.ownerConnected) {
    return {
      evict: false,
      reason: "connected-publisher",
    };
  }

  return {
    evict: true,
    reason: "disconnected-publisher",
  };
}
