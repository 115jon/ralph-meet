import { apiError, getDB } from "@/lib/api-helpers";
import { ServiceError } from "@/lib/service-error";
import { getPublicMessageShare } from "@/services/message-share.service";
import { createFileRoute } from "@tanstack/react-router";

const GET = async ({ params }: any) => {
  try {
    const share = await getPublicMessageShare(getDB(), params.token);
    return Response.json(
      { share },
      {
        headers: {
          "Cache-Control": "no-store",
          "X-Robots-Tag": share.allow_indexing ? "index, follow" : "noindex, nofollow",
        },
      }
    );
  } catch (error) {
    if (error instanceof ServiceError) {
      return apiError(error.message, error.status, error.code);
    }
    throw error;
  }
};

export const Route = createFileRoute("/api/shared-messages/$token")({
  server: {
    handlers: {
      GET,
    },
  },
});
