import { apiSuccess, getDB, requireAuth } from "@/lib/api-helpers";
import { cacheDel, cacheFetch, CacheKey, CacheTTL } from "@/lib/cache";
import { ensureUser } from "@/lib/ensure-user";
import { checkRateLimitDO, RATE_LIMITS } from "@/lib/rate-limit";
import { ServiceError } from "@/lib/service-error";
import { CreateServerSchema } from "@/lib/validations";
import { createServer, listUserServers } from "@/services/server.service";


// GET /api/servers — list servers the current user is a member of
export async function GET() {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  const db = getDB();

  // Ensure the user exists in D1
  await ensureUser(userId);

  // Cache-aside: check KV first, then D1
  const results = await cacheFetch(
    CacheKey.userServers(userId),
    CacheTTL.USER_SERVERS,
    () => listUserServers(db, userId)
  );

  return apiSuccess(results);
}

// POST /api/servers — create a new server
export async function POST(request: Request) {
  const authResult = await requireAuth();
  if (authResult instanceof Response) return authResult;
  const { userId } = authResult;

  // Rate limit: 5 servers per hour (using global DO token bucket)
  const rl = await checkRateLimitDO(userId, "server-create", RATE_LIMITS.SERVER_CREATE);
  if (rl) return rl;

  // Validate input with Zod
  const raw = await request.json();
  const parsed = CreateServerSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }

  const db = getDB();

  // Ensure the user exists in D1 before FK-referencing them
  await ensureUser(userId);

  try {
    const server = await createServer(db, userId, parsed.data);

    // Cache invalidation
    await cacheDel(CacheKey.userServers(userId));

    return apiSuccess(server, 201);
  } catch (e) {
    if (e instanceof ServiceError) {
      return Response.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
}
