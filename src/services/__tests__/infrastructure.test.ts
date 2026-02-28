import { beforeEach, describe, expect, it } from "vitest";
import { createMockD1 } from "../../lib/__tests__/mock-d1";
import { ServiceError } from "../../lib/service-error";

describe("Infrastructure: ServiceError", () => {
  it("creates error with default status 400", () => {
    const err = new ServiceError("bad input");
    expect(err.message).toBe("bad input");
    expect(err.status).toBe(400);
    expect(err.name).toBe("ServiceError");
    expect(err).toBeInstanceOf(Error);
  });

  it("static badRequest()", () => {
    const err = ServiceError.badRequest("missing field", "MISSING_FIELD");
    expect(err.status).toBe(400);
    expect(err.code).toBe("MISSING_FIELD");
  });

  it("static forbidden()", () => {
    const err = ServiceError.forbidden("no access");
    expect(err.status).toBe(403);
  });

  it("static notFound()", () => {
    const err = ServiceError.notFound("not here");
    expect(err.status).toBe(404);
  });

  it("static conflict()", () => {
    const err = ServiceError.conflict("already exists");
    expect(err.status).toBe(409);
  });
});

describe("Infrastructure: MockD1Database", () => {
  let db: ReturnType<typeof createMockD1>;

  beforeEach(() => {
    db = createMockD1();
  });

  it("returns empty results by default for .all()", async () => {
    const result = await db.prepare("SELECT * FROM servers").all();
    expect(result).toEqual({ results: [], success: true });
  });

  it("returns null by default for .first()", async () => {
    const result = await db.prepare("SELECT * FROM servers WHERE id = ?").bind("s1").first();
    expect(result).toBeNull();
  });

  it("mockQuery returns configured response for .all()", async () => {
    db.mockQuery(/SELECT.*FROM servers/, {
      results: [{ id: "s1", name: "Test Server" }],
    });
    const result = await db.prepare("SELECT * FROM servers WHERE owner = ?").bind("u1").all();
    expect(result.results).toHaveLength(1);
    expect(result.results![0].name).toBe("Test Server");
  });

  it("mockQuery returns configured response for .first()", async () => {
    db.mockQuery(/SELECT.*FROM users/, { id: "u1", username: "alice" });
    const result = await db.prepare("SELECT * FROM users WHERE id = ?").bind("u1").first();
    expect(result).toEqual({ id: "u1", username: "alice" });
  });

  it("records calls with bindings", async () => {
    await db.prepare("INSERT INTO servers (id, name) VALUES (?, ?)").bind("s1", "My Server").run();
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0].sql).toBe("INSERT INTO servers (id, name) VALUES (?, ?)");
    expect(db.calls[0].bindings).toEqual(["s1", "My Server"]);
    expect(db.calls[0].method).toBe("run");
  });

  it("assertCalled succeeds on match", () => {
    db.prepare("SELECT * FROM servers").all();
    // Async, but we can check the calls have been queued synchronously
    expect(() => db.assertCalled(/servers/)).not.toThrow();
  });

  it("assertCalled throws on no match", () => {
    expect(() => db.assertCalled(/users/)).toThrow("Expected query matching");
  });

  it("assertCalledWith matches bindings", async () => {
    await db.prepare("DELETE FROM servers WHERE id = ?").bind("s1").run();
    expect(() => db.assertCalledWith(/DELETE.*servers/, ["s1"])).not.toThrow();
    expect(() => db.assertCalledWith(/DELETE.*servers/, ["s999"])).toThrow();
  });

  it("assertNotCalled succeeds when query was not called", () => {
    expect(() => db.assertNotCalled(/DROP TABLE/)).not.toThrow();
  });

  it("batch executes all statements", async () => {
    const stmt1 = db.prepare("INSERT INTO a (id) VALUES (?)").bind("1");
    const stmt2 = db.prepare("INSERT INTO b (id) VALUES (?)").bind("2");
    const results = await db.batch([stmt1, stmt2]);
    expect(results).toHaveLength(2);
    expect(db.calls).toHaveLength(2);
  });

  it("reset clears rules and calls", async () => {
    db.mockQuery(/SELECT/, { results: [{ id: "1" }] });
    await db.prepare("SELECT 1").all();
    expect(db.calls).toHaveLength(1);

    db.reset();
    expect(db.calls).toHaveLength(0);
    // After reset, default behavior returns empty
    const r = await db.prepare("SELECT 1").all();
    expect(r.results).toEqual([]);
  });

  it("later rules take priority over earlier ones", async () => {
    db.mockQuery(/SELECT.*servers/, { results: [{ id: "old" }] });
    db.mockQuery(/SELECT.*servers/, { results: [{ id: "new" }] });
    const r = await db.prepare("SELECT * FROM servers").all();
    expect(r.results![0].id).toBe("new");
  });

  it("bindingsMatch filters query matches", async () => {
    db.mockQuery(/SELECT.*users/, { id: "u1", username: "alice" }, ["u1"]);
    db.mockQuery(/SELECT.*users/, { id: "u2", username: "bob" }, ["u2"]);

    const alice = await db.prepare("SELECT * FROM users WHERE id = ?").bind("u1").first();
    const bob = await db.prepare("SELECT * FROM users WHERE id = ?").bind("u2").first();

    expect(alice).toEqual({ id: "u1", username: "alice" });
    expect(bob).toEqual({ id: "u2", username: "bob" });
  });
});
