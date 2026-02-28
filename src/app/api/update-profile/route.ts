import { apiSuccess, apiError } from "@/lib/api-helpers";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return apiError("Unauthorized", 401);
  }

  let body: {
    displayName?: string;
    username?: string;
  };

  try {
    body = await req.json();
  } catch {
    return apiError("Invalid JSON", 400);
  }

  const { displayName, username } = body;

  try {
    const client = await clerkClient();

    // Build update payload
    const updatePayload: Record<string, unknown> = {};

    if (displayName !== undefined) {
      // Set firstName = displayName, clear lastName
      // This ensures fullName reflects the custom display name
      updatePayload.firstName = displayName || undefined;
      updatePayload.lastName = "";
      updatePayload.unsafeMetadata = { displayName: displayName || undefined };
    }

    if (username !== undefined) {
      updatePayload.username = username.trim().toLowerCase();
    }

    const updatedUser = await client.users.updateUser(userId, updatePayload);

    return NextResponse.json({
      success: true,
      user: {
        username: updatedUser.username,
        firstName: updatedUser.firstName,
        imageUrl: updatedUser.imageUrl,
      },
    });
  } catch (err: unknown) {
    console.error("[update-profile] Error:", err);

    const clerkErr = err as { errors?: { message?: string; longMessage?: string; code?: string }[] };
    if (clerkErr.errors?.[0]) {
      const e = clerkErr.errors[0];
      return NextResponse.json(
        { error: e.longMessage || e.message || "Update failed", code: e.code },
        { status: 422 }
      );
    }
    return apiError("Failed to update profile", 500);
  }
}
