import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db/client.js";

describe("GET /health", () => {
  it("returns ok", async () => {
    // The pool connects lazily, so no database is needed for this route.
    const { db, pool } = createDb("postgres://unused@localhost:5432/unused");
    const app = buildApp({ db, config: loadConfig({ JWT_SECRET: "x".repeat(32) }) });
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
    await app.close();
    await pool.end();
  });
});
