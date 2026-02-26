import InviteClient from "@/components/chat/InviteClient";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Join Server — Ralph Meet",
  description: "You've been invited to join a server on Ralph Meet. Connect and chat with friends in real-time.",
};

export default function InvitePage() {
  return <InviteClient />;
}
