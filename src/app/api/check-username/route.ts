import { apiSuccess, apiError } from "@/lib/api-helpers";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  // Must be authenticated to check usernames
  const { userId } = await auth();
  if (!userId) {
    return apiError("Unauthorized", 401);
  }

  const username = req.nextUrl.searchParams.get("username");
  if (!username || username.length < 2) {
    return NextResponse.json({ available: false, reason: "too_short" });
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
    return NextResponse.json(
      { available: false, reason: "error" },
      { status: 500 }
    );
  }
}
