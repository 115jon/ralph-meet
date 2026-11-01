import { apiFetch, apiJson, ApiError } from "@/lib/api";

import {
  FriendRequestResultSchema,
  RelationshipListSchema,
  type Relationship,
} from "./schema";

const JSON_HEADERS = { "Content-Type": "application/json" };

/** GET /api/friends: friends, requests both ways and blocks. */
export function fetchRelationships() {
  return apiJson("/api/friends", RelationshipListSchema);
}

/**
 * POST /api/friends {username}: sends a request, or accepts theirs if they
 * already asked. Throws ApiError with the status (404, 400, 409) on refusal.
 */
export async function postFriendRequest(
  username: string,
): Promise<Relationship> {
  return apiJson("/api/friends", FriendRequestResultSchema, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ username }),
  });
}

interface RelationshipBody {
  readonly target_user_id: string;
  readonly action?: "accept" | "block";
}

async function send(
  method: "PUT" | "DELETE",
  body: RelationshipBody,
): Promise<void> {
  const response = await apiFetch("/api/friends", {
    method,
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new ApiError(response.status, "/api/friends");
}

/** PUT /api/friends {action: "accept"}: accepts their request. */
export function putAccept(userId: string): Promise<void> {
  return send("PUT", { target_user_id: userId, action: "accept" });
}

/** PUT /api/friends {action: "block"}: blocks them (and drops any friendship). */
export function putBlock(userId: string): Promise<void> {
  return send("PUT", { target_user_id: userId, action: "block" });
}

/** DELETE /api/friends: remove a friend, ignore, cancel or unblock. */
export function deleteRelationship(userId: string): Promise<void> {
  return send("DELETE", { target_user_id: userId });
}
