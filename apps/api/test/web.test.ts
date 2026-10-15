import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db/client.js";

describe("serving the web app", () => {
  it("serves files, falls back to index.html for app routes and keeps API errors as JSON", async () => {
    const webDir = mkdtempSync(join(tmpdir(), "dfit-web-"));
    writeFileSync(join(webDir, "index.html"), "<html>app</html>");
    writeFileSync(join(webDir, "sw.js"), "// sw");
    const { db, pool } = createDb("postgres://unused@localhost:5432/unused");
    const app = buildApp({ db, config: loadConfig({ JWT_SECRET: "x".repeat(32) }), webDir });

    const home = await app.inject({ method: "GET", url: "/" });
    expect(home.statusCode).toBe(200);
    expect(home.headers["cache-control"]).toBe("no-cache");

    const deep = await app.inject({ method: "GET", url: "/equipe/alunos" });
    expect(deep.statusCode).toBe(200);
    expect(deep.body).toContain("app");

    expect((await app.inject({ method: "GET", url: "/sw.js" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/assets/gone.js" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/staff/nothing" })).json()).toEqual({ error: "not_found" });
    expect((await app.inject({ method: "GET", url: "/health" })).json()).toEqual({ status: "ok" });

    await app.close();
    await pool.end();
  });
});
