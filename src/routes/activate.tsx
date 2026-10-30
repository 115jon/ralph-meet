import { AuthSplitLayout } from "@/components/auth/AuthSplitLayout";
import { DeviceActivation } from "@/components/auth/DeviceActivation";
import { formatDeviceCode } from "@/lib/device-code-format";
import { createFileRoute } from "@tanstack/react-router";

type ActivateSearch = {
  code?: string;
  /** Set by "Not you?" when it couldn't release the code before signing out. */
  release?: "failed";
};

/**
 * Kova's device verification URL for Ralph Meet:
 * https://<public web host>/activate?code=XXXX-XXXX (host from config)
 */
export const Route = createFileRoute("/activate")({
  validateSearch: (search: Record<string, unknown>): ActivateSearch => {
    const code = typeof search.code === "string" ? search.code : undefined;
    return {
      ...(code ? { code } : {}),
      ...(search.release === "failed" ? { release: "failed" as const } : {}),
    };
  },
  component: ActivatePage,
  head: () => ({
    meta: [
      { title: "Connect a device — Ralph Meet" },
      { name: "robots", content: "noindex" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
});

function ActivatePage() {
  const { code, release } = Route.useSearch();
  const key = formatDeviceCode(code) || "none";
  return (
    <AuthSplitLayout>
      <DeviceActivation
        key={key}
        initialCode={code}
        releaseFailed={release === "failed"}
      />
    </AuthSplitLayout>
  );
}
