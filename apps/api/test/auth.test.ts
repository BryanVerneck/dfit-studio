import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { hashPassword } from "../src/auth/password.js";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb, type Db } from "../src/db/client.js";
import { memberships, studios, users } from "../src/db/schema.js";

// These tests need a migrated Postgres. They are skipped when DATABASE_URL is not set.
describe.skipIf(!process.env.DATABASE_URL)("login", () => {
  const slug = `auth-${Date.now()}`;
  const secretEnv = { JWT_SECRET: "test-secret-".repeat(4), AUTH_RATE_LIMIT_PER_MINUTE: "1000" };
  let db: Db;
  let pool: ReturnType<typeof createDb>["pool"];
  let app: FastifyInstance;
  let studioId: string;

  const email = (name: string) => `${slug}-${name}@example.com`;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const refreshCookie = (res: { cookies: { name: string; value: string }[] }) =>
    res.cookies.find((c) => c.name === "refresh_token")?.value;

  async function post(url: string, payload?: object, opts: { headers?: object; refresh?: string } = {}) {
    return app.inject({
      method: "POST",
      url,
      payload,
      headers: opts.headers as Record<string, string> | undefined,
      cookies: opts.refresh ? { refresh_token: opts.refresh } : undefined,
    });
  }
  const login = (name: string, password: string) => post("/auth/login", { email: email(name), password });

  async function addUser(name: string, role: "owner" | "staff" | "student", password = "password-123") {
    const [user] = await db
      .insert(users)
      .values({ email: email(name), name, passwordHash: await hashPassword(password) })
      .returning();
    await db.insert(memberships).values({ studioId, userId: user.id, role, status: "active" });
    return user;
  }

  beforeAll(async () => {
    ({ db, pool } = createDb());
    app = buildApp({ db, config: loadConfig(secretEnv) });
    const [studio] = await db
      .insert(studios)
      .values({ name: "Auth test studio", slug, timezone: "America/Sao_Paulo" })
      .returning();
    studioId = studio.id;
    await addUser("owner", "owner");
  });

  afterAll(async () => {
    await app.close();
    await db.execute(sql`delete from refresh_tokens where studio_id = ${studioId}`);
    await db.execute(sql`delete from agreements where studio_id = ${studioId}`);
    await db.execute(sql`delete from students where studio_id = ${studioId}`);
    await db.execute(sql`delete from memberships where studio_id = ${studioId}`);
    await db.execute(sql`delete from users where email like ${slug + "-%"}`);
    await db.execute(sql`delete from studios where id = ${studioId}`);
    await pool.end();
  });

  it("registers a student as pending and blocks login until approved", async () => {
    const body = { studioSlug: slug, email: email("ana"), password: "ana-password", name: "Ana" };
    expect((await post("/auth/register", body)).statusCode).toBe(201);
    expect((await post("/auth/register", body)).statusCode).toBe(409);
    expect((await post("/auth/register", { ...body, email: email("x"), password: "short" })).statusCode).toBe(400);
    expect((await post("/auth/register", { ...body, email: email("y"), studioSlug: "nope" })).statusCode).toBe(404);

    const blocked = await login("ana", "ana-password");
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toBe("pending_approval");
  });

  it("rejects wrong passwords and unknown emails the same way", async () => {
    const wrong = await login("owner", "wrong-password");
    const unknown = await login("nobody", "whatever-123");
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it("lets staff approve a pending student, who can then log in", async () => {
    const owner = (await login("owner", "password-123")).json();
    const pending = await app.inject({ method: "GET", url: "/staff/pending-students", headers: bearer(owner.accessToken) });
    expect(pending.json().map((p: { email: string }) => p.email)).toContain(email("ana"));
    const ana = pending.json().find((p: { email: string }) => p.email === email("ana"));

    const approve = await post(`/staff/students/${ana.userId}/approve`, undefined, { headers: bearer(owner.accessToken) });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().studentId).toBeTruthy();
    expect((await post(`/staff/students/${ana.userId}/approve`, undefined, { headers: bearer(owner.accessToken) })).statusCode).toBe(404);

    const session = await login("ana", "ana-password");
    expect(session.statusCode).toBe(200);
    expect(session.json().role).toBe("student");
    const me = await app.inject({ method: "GET", url: "/me", headers: bearer(session.json().accessToken) });
    expect(me.json()).toMatchObject({ email: email("ana"), name: "Ana", mustChangePassword: false });
  });

  it("lists active students with their current weekly limit", async () => {
    const owner = (await login("owner", "password-123")).json();
    const list = () => app.inject({ method: "GET", url: "/staff/students", headers: bearer(owner.accessToken) });
    const before = (await list()).json().find((s: { email: string }) => s.email === email("ana"));
    expect(before).toMatchObject({ name: "Ana", weeklyLimit: null });

    const set = await post(`/staff/students/${before.studentId}/agreement`, { weeklyLimit: 3 }, { headers: bearer(owner.accessToken) });
    expect(set.statusCode).toBe(200);
    const after = (await list()).json().find((s: { email: string }) => s.email === email("ana"));
    expect(after.weeklyLimit).toBe(3);

    const student = (await login("ana", "ana-password")).json();
    expect((await app.inject({ method: "GET", url: "/staff/students", headers: bearer(student.accessToken) })).statusCode).toBe(403);
  });

  it("lets staff create a student with a limit and a temporary password", async () => {
    const owner = (await login("owner", "password-123")).json();
    const created = await post("/staff/students", { name: "Carla", email: email("carla"), phone: "11 90000-0000", weeklyLimit: 2 }, { headers: bearer(owner.accessToken) });
    expect(created.statusCode).toBe(201);
    const { temporaryPassword, studentId } = created.json();
    expect(temporaryPassword).toHaveLength(12);

    const list = await app.inject({ method: "GET", url: "/staff/students", headers: bearer(owner.accessToken) });
    expect(list.json().find((s: { studentId: string }) => s.studentId === studentId)).toMatchObject({ name: "Carla", phone: "11 90000-0000", weeklyLimit: 2 });

    const first = await login("carla", temporaryPassword);
    expect(first.statusCode).toBe(200);
    expect(first.json().mustChangePassword).toBe(true);

    const again = await post("/staff/students", { name: "Carla 2", email: email("carla"), weeklyLimit: 2 }, { headers: bearer(owner.accessToken) });
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe("email_taken");
    expect((await post("/staff/students", { name: "X", email: "nope", weeklyLimit: 2 }, { headers: bearer(owner.accessToken) })).statusCode).toBe(400);
  });

  it("protects routes by token and by role", async () => {
    expect((await app.inject({ method: "GET", url: "/me" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/me", headers: bearer("garbage") })).statusCode).toBe(401);

    const other = buildApp({ db, config: loadConfig({ ...secretEnv, JWT_SECRET: "another-secret-".repeat(3) }) });
    const foreign = (await other.inject({ method: "POST", url: "/auth/login", payload: { email: email("owner"), password: "password-123" } })).json();
    await other.close();
    expect((await app.inject({ method: "GET", url: "/me", headers: bearer(foreign.accessToken) })).statusCode).toBe(401);

    const student = (await login("ana", "ana-password")).json();
    const res = await app.inject({ method: "GET", url: "/staff/pending-students", headers: bearer(student.accessToken) });
    expect(res.statusCode).toBe(403);
  });

  it("rotates refresh tokens and logs the user out everywhere if one is replayed", async () => {
    const first = await login("ana", "ana-password");
    const t1 = refreshCookie(first)!;
    const second = await post("/auth/refresh", undefined, { refresh: t1 });
    expect(second.statusCode).toBe(200);
    const t2 = refreshCookie(second)!;
    expect(t2).not.toBe(t1);

    const replay = await post("/auth/refresh", undefined, { refresh: t1 });
    expect(replay.statusCode).toBe(401);
    expect((await post("/auth/refresh", undefined, { refresh: t2 })).statusCode).toBe(401);
  });

  it("revokes the refresh token on logout", async () => {
    const t = refreshCookie(await login("ana", "ana-password"))!;
    expect((await post("/auth/logout", undefined, { refresh: t })).statusCode).toBe(204);
    expect((await post("/auth/refresh", undefined, { refresh: t })).statusCode).toBe(401);
  });

  it("issues a temporary password that must be replaced before anything else", async () => {
    const owner = (await login("owner", "password-123")).json();
    const ana = (await login("ana", "ana-password")).json();
    const me = await app.inject({ method: "GET", url: "/me", headers: bearer(ana.accessToken) });
    const reset = await post(`/staff/users/${me.json().id}/temporary-password`, undefined, { headers: bearer(owner.accessToken) });
    const { temporaryPassword } = reset.json();
    expect(temporaryPassword).toHaveLength(12);

    expect((await login("ana", "ana-password")).statusCode).toBe(401);
    const temp = await login("ana", temporaryPassword);
    expect(temp.statusCode).toBe(200);
    expect(temp.json().mustChangePassword).toBe(true);
    const tempToken = temp.json().accessToken;

    const blocked = await app.inject({ method: "GET", url: "/staff/pending-students", headers: bearer(tempToken) });
    expect(blocked.json().error).toBe("password_change_required");
    expect((await app.inject({ method: "GET", url: "/me", headers: bearer(tempToken) })).statusCode).toBe(200);

    const bad = await post("/auth/change-password", { currentPassword: "nope", newPassword: "brand-new-pass" }, { headers: bearer(tempToken) });
    expect(bad.statusCode).toBe(401);
    const changed = await post("/auth/change-password", { currentPassword: temporaryPassword, newPassword: "brand-new-pass" }, { headers: bearer(tempToken) });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().mustChangePassword).toBe(false);
    expect((await login("ana", "brand-new-pass")).statusCode).toBe(200);
    expect((await login("ana", temporaryPassword)).statusCode).toBe(401);
  });

  it("only lets owners reset staff or owner passwords", async () => {
    const staff = await addUser("staff", "staff");
    const ownerUser = (await db.select().from(users).where(sql`email = ${email("owner")}`))[0];
    const staffToken = (await login("staff", "password-123")).json().accessToken;
    const denied = await post(`/staff/users/${ownerUser.id}/temporary-password`, undefined, { headers: bearer(staffToken) });
    expect(denied.statusCode).toBe(403);
    const ownerToken = (await login("owner", "password-123")).json().accessToken;
    const allowed = await post(`/staff/users/${staff.id}/temporary-password`, undefined, { headers: bearer(ownerToken) });
    expect(allowed.statusCode).toBe(200);
  });

  it("rate limits repeated login attempts", async () => {
    const strict = buildApp({ db, config: loadConfig({ ...secretEnv, AUTH_RATE_LIMIT_PER_MINUTE: "3" }) });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await strict.inject({ method: "POST", url: "/auth/login", payload: { email: email("owner"), password: "wrong-pass-1" } })).statusCode);
    }
    await strict.close();
    expect(codes).toEqual([401, 401, 401, 429, 429]);
  });
});
