/**
 * Category Service — pure business logic for category operations.
 *
 * All functions accept a D1Database, return plain objects, and throw ServiceError
 * for error cases. Side effects are returned declaratively.
 */

import { CacheKey } from "@/lib/cache";
import { ServiceError } from "@/lib/service-error";
import type { D1Database } from "@cloudflare/workers-types";
import type { BroadcastDescriptor, ServiceResult } from "./server.service";

// ─── ID generator (injectable for testing) ───────────────────────────────────

let _genId = (): string => crypto.randomUUID();

export function setCategoryIdGenerator(fn: () => string): void {
  _genId = fn;
}

// ─── createCategory ──────────────────────────────────────────────────────────

export interface CreateCategoryInput {
  name: string;
}

export async function createCategory(
  db: D1Database,
  serverId: string,
  actorId: string,
  input: CreateCategoryInput
): Promise<
  ServiceResult<{
    id: string;
    server_id: string;
    name: string;
    rank: number;
  }>
> {
  const name = input.name.trim();
  if (!name) {
    throw ServiceError.badRequest("Category name is required");
  }

  const categoryId = _genId();

  const rankRow = (await db
    .prepare(
      `SELECT COALESCE(MAX(rank), -1) + 1 as next_rank FROM categories WHERE server_id = ?`
    )
    .bind(serverId)
    .first()) as { next_rank: number } | null;

  const rank = rankRow?.next_rank ?? 0;

  await db
    .prepare(
      `INSERT INTO categories (id, server_id, name, rank) VALUES (?, ?, ?, ?)`
    )
    .bind(categoryId, serverId, name, rank)
    .run();

  return {
    data: {
      id: categoryId,
      server_id: serverId,
      name,
      rank,
    },
    cacheKeysToInvalidate: [CacheKey.serverChannels(serverId)],
    broadcast: {
      type: "all",
      event: "CHANNEL_UPDATE",
      data: { server_id: serverId },
    },
  };
}

// ─── deleteCategory ──────────────────────────────────────────────────────────

export async function deleteCategory(
  db: D1Database,
  serverId: string,
  actorId: string,
  categoryId: string
): Promise<{
  cacheKeysToInvalidate: string[];
  broadcast: BroadcastDescriptor;
}> {
  // Nullify channels referencing this category (safe even if FK cascade is in place)
  await db
    .prepare(`UPDATE channels SET category_id = NULL WHERE category_id = ?`)
    .bind(categoryId)
    .run();

  await db
    .prepare(`DELETE FROM categories WHERE id = ? AND server_id = ?`)
    .bind(categoryId, serverId)
    .run();

  return {
    cacheKeysToInvalidate: [CacheKey.serverChannels(serverId)],
    broadcast: {
      type: "all",
      event: "CHANNEL_UPDATE",
      data: { server_id: serverId },
    },
  };
}
