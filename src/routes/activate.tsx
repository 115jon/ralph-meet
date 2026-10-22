import { AuthSplitLayout } from "@/components/auth/AuthSplitLayout";
import { DeviceActivation } from "@/components/auth/DeviceActivation";
import { formatDeviceCode } from "@/lib/device-code-format";
import { createFileRoute } from "@tanstack/react-router";

type ActivateSearch = {
  code?: string;
};

/**
 * Kova's device verification URL for Ralph Meet:
 * https://meet.115jon.site/activate?code=XXXX-XXXX
 */
export const Route = createFileRoute("/activate")({
  validateSearch: (search: Record<string, unknown>): ActivateSearch => {
    const code = typeof search.code === "string" ? search.code : undefined;
    return code ? { code } : {};
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
  const { code } = Route.useSearch();
  const key = formatDeviceCode(code) || "none";
  return (
    <AuthSplitLayout>
      <DeviceActivation key={key} initialCode={code} />
    </AuthSplitLayout>
  );
}
