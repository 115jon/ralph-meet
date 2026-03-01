import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { ServiceError } from "@/lib/service-error";
import { createRole, listServerRoles } from "@/services/role.service";
import { executeAuditLog } from "@/services/service-helpers";


// GET /api/servers/:id/roles — list all roles for a server
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: serverId } = await params;

  const db = getDB();

  try {
    const roles = await listServerRoles(db, serverId, userId);
    return apiSuccess(roles);
  } catch (e) {
    if (e instanceof ServiceError) {
      return Response.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}

// POST /api/servers/:id/roles — create a new role
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;
  const { id: serverId } = await params;

  const db = getDB();
  const body = (await request.json()) as { name: string; color?: string; permissions?: number };

  try {
    const result = await createRole(db, serverId, userId, {
      name: body.name,
      color: body.color,
      permissions: body.permissions,
    });

    if (result.auditLog) {
      await executeAuditLog(db, result.auditLog);
    }

    return apiSuccess(result.data, 201);
  } catch (e) {
    if (e instanceof ServiceError) {
      return Response.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}
