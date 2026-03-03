import { createFileRoute } from '@tanstack/react-router';

import { apiSuccess, getDB } from "@/lib/api-helpers";

// GET /api/invites/:code — preview invite info (no auth required)
const GET = async ({ params }: any) => {
  const { code } = params;
  const db = getDB();

  const invite = await db
    .prepare(
      `SELECT i.code, i.server_id, i.expires_at, i.max_uses, i.uses,
              s.name AS server_name, s.icon_url AS server_icon,
              u.username AS inviter_name, u.avatar_url AS inviter_avatar,
              (SELECT COUNT(*) FROM server_members WHERE server_id = i.server_id) AS member_count
       FROM invites i
       JOIN servers s ON s.id = i.server_id
       JOIN users u ON u.id = i.inviter_id
       WHERE i.code = ?`
    )
    .bind(code)
    .first<{
      code: string;
      server_id: string;
      expires_at: string | null;
      max_uses: number | null;
      uses: number;
      server_name: string;
      server_icon: string | null;
      inviter_name: string;
      inviter_avatar: string | null;
      member_count: number;
    }>();

  if (!invite) {
    return Response.json({ error: "Invite not found or expired" }, { status: 404 });
  }

  // Check expiry
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return Response.json({ error: "Invite has expired" }, { status: 410 });
  }

  // Check max uses
  if (invite.max_uses && invite.uses >= invite.max_uses) {
    return Response.json({ error: "Invite has reached maximum uses" }, { status: 410 });
  }

  return apiSuccess({
    code: invite.code,
    server: {
      id: invite.server_id,
      name: invite.server_name,
      icon_url: invite.server_icon,
      member_count: invite.member_count,
    },
    inviter: {
      username: invite.inviter_name,
      avatar_url: invite.inviter_avatar,
    },
  });
};


export const Route = createFileRoute('/api/invites/$code/')({
  server: {
    handlers: {
      GET,
    }
  }
} as any);
