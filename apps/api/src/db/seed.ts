import { eq } from "drizzle-orm";
import { hashPassword } from "../auth/password.js";
import { createDb } from "./client.js";
import { memberships, studios, users } from "./schema.js";

// Creates the Dfit studio and its first owner. Safe to run more than once.
const ownerEmail = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();
const ownerPassword = process.env.SEED_OWNER_PASSWORD;
if (!ownerEmail || !ownerPassword || ownerPassword.length < 8) {
  throw new Error("Set SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD (at least 8 characters)");
}

const { db, pool } = createDb();

await db
  .insert(studios)
  .values({
    name: "Dfit Studio",
    slug: process.env.SEED_STUDIO_SLUG ?? "dfit",
    timezone: process.env.SEED_STUDIO_TIMEZONE ?? "America/Sao_Paulo",
  })
  .onConflictDoNothing({ target: studios.slug });
const [studio] = await db.select().from(studios).where(eq(studios.slug, process.env.SEED_STUDIO_SLUG ?? "dfit"));

await db
  .insert(users)
  .values({ email: ownerEmail, name: process.env.SEED_OWNER_NAME ?? "Owner", passwordHash: await hashPassword(ownerPassword) })
  .onConflictDoNothing({ target: users.email });
const [owner] = await db.select().from(users).where(eq(users.email, ownerEmail));

await db
  .insert(memberships)
  .values({ studioId: studio.id, userId: owner.id, role: "owner", status: "active" })
  .onConflictDoNothing();

await pool.end();
console.log(`Seeded studio "${studio.slug}" with owner ${ownerEmail}`);
