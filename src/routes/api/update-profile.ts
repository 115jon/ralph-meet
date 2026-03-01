import { createFileRoute } from '@tanstack/react-router';

import { apiError, apiSuccess, requireAuth } from "@/lib/api-helpers";
import { clerkClient } from "@clerk/tanstack-react-start/server";

const PATCH = async ({ request: req, params }: any) => {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

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

    return apiSuccess({
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
      return Response.json(
        { error: e.longMessage || e.message || "Update failed", code: e.code },
        { status: 422 }
      );
    }
    return apiError("Failed to update profile", 500);
  }
}


export const Route = createFileRoute('/api/update-profile')({
  server: {
    handlers: {
      PATCH,
    }
  }
});
