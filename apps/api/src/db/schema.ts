import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const membershipRole = pgEnum("membership_role", ["owner", "staff", "student"]);
export const membershipStatus = pgEnum("membership_status", ["pending", "active", "inactive"]);
export const studentStatus = pgEnum("student_status", ["active", "paused", "inactive"]);
export const sessionStatus = pgEnum("session_status", ["scheduled", "cancelled"]);
export const bookingSource = pgEnum("booking_source", ["standing", "one_off"]);
export const bookingStatus = pgEnum("booking_status", ["booked", "cancelled", "attended", "no_show"]);

const id = () => uuid("id").primaryKey().defaultRandom();
const studioId = () =>
  uuid("studio_id")
    .notNull()
    .references(() => studios.id);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const studios = pgTable("studios", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull(),
  // ISO weekdays (1 = Monday ... 7 = Sunday) that make up the booking week. Dfit: Monday to Friday.
  bookingWeekDays: smallint("booking_week_days")
    .array()
    .notNull()
    .default(sql`'{1,2,3,4,5}'`),
  cancellationCutoffMinutes: integer("cancellation_cutoff_minutes").notNull().default(60),
  bookingWindowDays: integer("booking_window_days").notNull().default(28),
  settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
});

// Global identity: one person can belong to several studios through memberships.
export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  phone: text("phone"),
  gender: text("gender"),
  passwordHash: text("password_hash").notNull(),
  // Set when staff issue a temporary password; the user must choose a new one before doing anything else.
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  createdAt: createdAt(),
});

// Long-lived login tokens. Only a hash is stored; each use rotates the token.
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    studioId: studioId(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("refresh_tokens_user_idx").on(t.userId)],
);

export const memberships = pgTable(
  "memberships",
  {
    id: id(),
    studioId: studioId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: membershipRole("role").notNull(),
    status: membershipStatus("status").notNull().default("pending"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("memberships_studio_user_uq").on(t.studioId, t.userId)],
);

export const students = pgTable(
  "students",
  {
    id: id(),
    studioId: studioId(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    status: studentStatus("status").notNull().default("active"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("students_studio_user_uq").on(t.studioId, t.userId)],
);

// The deal made outside the system. A new row per change keeps the history.
export const agreements = pgTable(
  "agreements",
  {
    id: id(),
    studioId: studioId(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id),
    weeklyLimit: integer("weekly_limit").notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [
    index("agreements_student_idx").on(t.studentId, t.validFrom),
    check("agreements_weekly_limit_ck", sql`${t.weeklyLimit} >= 0`),
    check("agreements_valid_range_ck", sql`${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`),
  ],
);

// The weekly timetable: one row per class per weekday.
export const classSlots = pgTable(
  "class_slots",
  {
    id: id(),
    studioId: studioId(),
    name: text("name").notNull(),
    weekday: smallint("weekday").notNull(),
    startTime: time("start_time").notNull(),
    durationMin: integer("duration_min").notNull(),
    capacity: integer("capacity").notNull(),
    instructorId: uuid("instructor_id").references(() => users.id),
    activeFrom: date("active_from").notNull(),
    activeTo: date("active_to"),
    createdAt: createdAt(),
  },
  (t) => [
    index("class_slots_studio_weekday_idx").on(t.studioId, t.weekday, t.startTime),
    check("class_slots_weekday_ck", sql`${t.weekday} BETWEEN 1 AND 7`),
    check("class_slots_capacity_ck", sql`${t.capacity} > 0`),
    check("class_slots_duration_ck", sql`${t.durationMin} > 0`),
  ],
);

// One row per real class occurrence. booked_count is the seat counter that capacity checks update atomically.
export const classSessions = pgTable(
  "class_sessions",
  {
    id: id(),
    studioId: studioId(),
    slotId: uuid("slot_id")
      .notNull()
      .references(() => classSlots.id),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    capacity: integer("capacity").notNull(),
    bookedCount: integer("booked_count").notNull().default(0),
    status: sessionStatus("status").notNull().default("scheduled"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("class_sessions_slot_starts_uq").on(t.slotId, t.startsAt),
    index("class_sessions_studio_starts_idx").on(t.studioId, t.startsAt),
    check("class_sessions_capacity_ck", sql`${t.capacity} > 0`),
    check("class_sessions_booked_ck", sql`${t.bookedCount} >= 0 AND ${t.bookedCount} <= ${t.capacity}`),
  ],
);

// The fixed schedule: turned into bookings ahead of time.
export const standingEnrollments = pgTable(
  "standing_enrollments",
  {
    id: id(),
    studioId: studioId(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id),
    slotId: uuid("slot_id")
      .notNull()
      .references(() => classSlots.id),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    createdAt: createdAt(),
  },
  (t) => [
    index("standing_enrollments_student_idx").on(t.studentId),
    index("standing_enrollments_slot_idx").on(t.slotId),
    check("standing_enrollments_valid_range_ck", sql`${t.validTo} IS NULL OR ${t.validTo} >= ${t.validFrom}`),
  ],
);

export const bookings = pgTable(
  "bookings",
  {
    id: id(),
    studioId: studioId(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => classSessions.id),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id),
    source: bookingSource("source").notNull(),
    replacesBookingId: uuid("replaces_booking_id").references((): AnyPgColumn => bookings.id),
    status: bookingStatus("status").notNull().default("booked"),
    createdBy: uuid("created_by").references(() => users.id),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [
    // A student holds at most one active seat per class.
    uniqueIndex("bookings_active_session_student_uq")
      .on(t.sessionId, t.studentId)
      .where(sql`${t.status} = 'booked'`),
    // A retried request with the same key cannot book twice.
    uniqueIndex("bookings_idempotency_uq")
      .on(t.studioId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    index("bookings_student_status_idx").on(t.studentId, t.status),
    index("bookings_session_idx").on(t.sessionId),
  ],
);
