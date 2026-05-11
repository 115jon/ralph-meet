import { getRequestHeader } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";

export interface RalphAuthUser {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  imageUrl?: string | null;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  bio?: string | null;
  primaryEmailAddress?: { emailAddress?: string | null } | null;
}

export interface RalphAuthSession {
  id?: string;
  token?: string;
  userId?: string;
  expiresAt?: string | number | Date;
  createdAt?: string | number | Date;
  updatedAt?: string | number | Date;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function getRalphAuthSession(headers?: Headers): Promise<{ user: RalphAuthUser; session: RalphAuthSession } | null> {
  const authEnv = env as unknown as CloudflareEnv & {
    RALPH_AUTH_URL?: string;
    VITE_RALPH_AUTH_PUBLISHABLE_KEY?: string;
  };
  const authUrl = (authEnv.RALPH_AUTH_URL ?? "https://auth.115jon.site").replace(/\/$/, "");
  const publishableKey =
    authEnv.VITE_RALPH_AUTH_PUBLISHABLE_KEY ??
    "pk_dev_fhygLR-eApZ4HvSfu-v-LEGFp7WAsgkLRhlveveNzhk";
  const reqHeaders = new Headers();
  const authHeader = headers?.get("authorization") ?? getRequestHeader("authorization");
  const cookie = headers?.get("cookie") ?? getRequestHeader("cookie");
  if (authHeader) reqHeaders.set("authorization", authHeader);
  if (cookie) reqHeaders.set("cookie", cookie);
  if (publishableKey) reqHeaders.set("x-publishable-key", publishableKey);

  const res = await fetch(`${authUrl}/api/auth/get-session`, {
    headers: reqHeaders,
  }).catch(() => null);

  if (!res?.ok) return null;
  const data = await res.json().catch(() => null) as { user?: RalphAuthUser; session?: RalphAuthSession } | null;
  return data?.user && data?.session ? { user: data.user, session: data.session } : null;
}

export async function auth() {
  const session = await getRalphAuthSession();
  return {
    userId: session?.user.id ?? null,
    sessionId: session?.session.id ?? null,
  };
}

export async function getCurrentUser(headers?: Headers) {
  return (await getRalphAuthSession(headers))?.user ?? null;
}

export async function verifyToken(token: string) {
  const session = await getRalphAuthSession(new Headers({ authorization: `Bearer ${token}` }));
  return session?.user ? { sub: session.user.id } : null;
}
