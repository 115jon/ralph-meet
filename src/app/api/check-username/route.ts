import { apiSuccess, requireAuth } from "@/lib/api-helpers";
import { clerkClient } from "@clerk/tanstack-react-start/server";

export async function GET(req: Request) {
  // Must be authenticated to check usernames
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const url = new URL(req.url);
  const username = url.searchParams.get("username");
  if (!username || username.length < 2) {
    return apiSuccess({ available: false, reason: "too_short" });
  }

  try {
    const client = await clerkClient();
    // Search for users with this exact username
    const users = await client.users.getUserList({
      username: [username],
      limit: 1,
    });

    // If the only match is the current user, the username is "available" (it's theirs)
    const taken =
      users.data.length > 0 && users.data[0].id !== userId;

    return apiSuccess({ available: !taken });
  } catch (err) {
    console.error("[check-username] Error:", err);
    return apiSuccess(
      { available: false, reason: "error" }
    );
  }
}
