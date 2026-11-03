import InviteClient from "@/components/chat/InviteClient";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/invite/$code")({
  component: InvitePage,
  head: () => ({
    meta: [
      { title: "Join Server — Yap" },
      {
        name: "description",
        content:
          "You've been invited to join a server on Yap. Connect and chat with friends in real-time.",
      },
    ],
  }),
});

function InvitePage() {
  return <InviteClient />;
}
