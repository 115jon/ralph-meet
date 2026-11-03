import RoomPageClient from "@/components/RoomPageClient";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/room/$slug")({
  component: RoomPage,
  head: () => ({
    meta: [
      { title: "Meeting Room — Yap" },
      {
        name: "description",
        content:
          "Join your real-time video meeting on Yap. Secure, high-quality audio and video for your team.",
      },
    ],
  }),
});

function RoomPage() {
  return <RoomPageClient />;
}
