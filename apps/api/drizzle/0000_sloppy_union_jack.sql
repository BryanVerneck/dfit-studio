CREATE TYPE "public"."booking_source" AS ENUM('standing', 'one_off');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('booked', 'cancelled', 'attended', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'staff', 'student');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('pending', 'active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('scheduled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."student_status" AS ENUM('active', 'paused', 'inactive');--> statement-breakpoint
CREATE TABLE "agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"weekly_limit" integer NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agreements_weekly_limit_ck" CHECK ("agreements"."weekly_limit" >= 0),
	CONSTRAINT "agreements_valid_range_ck" CHECK ("agreements"."valid_to" IS NULL OR "agreements"."valid_to" >= "agreements"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"source" "booking_source" NOT NULL,
	"replaces_booking_id" uuid,
	"status" "booking_status" DEFAULT 'booked' NOT NULL,
	"created_by" uuid,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "class_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"capacity" integer NOT NULL,
	"booked_count" integer DEFAULT 0 NOT NULL,
	"status" "session_status" DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_sessions_capacity_ck" CHECK ("class_sessions"."capacity" > 0),
	CONSTRAINT "class_sessions_booked_ck" CHECK ("class_sessions"."booked_count" >= 0 AND "class_sessions"."booked_count" <= "class_sessions"."capacity")
);
--> statement-breakpoint
CREATE TABLE "class_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"name" text NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" time NOT NULL,
	"duration_min" integer NOT NULL,
	"capacity" integer NOT NULL,
	"instructor_id" uuid,
	"active_from" date NOT NULL,
	"active_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_slots_weekday_ck" CHECK ("class_slots"."weekday" BETWEEN 1 AND 7),
	CONSTRAINT "class_slots_capacity_ck" CHECK ("class_slots"."capacity" > 0),
	CONSTRAINT "class_slots_duration_ck" CHECK ("class_slots"."duration_min" > 0)
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"status" "membership_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "standing_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"slot_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "standing_enrollments_valid_range_ck" CHECK ("standing_enrollments"."valid_to" IS NULL OR "standing_enrollments"."valid_to" >= "standing_enrollments"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "student_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text NOT NULL,
	"booking_week_days" smallint[] DEFAULT '{1,2,3,4,5}' NOT NULL,
	"cancellation_cutoff_minutes" integer DEFAULT 60 NOT NULL,
	"booking_window_days" integer DEFAULT 28 NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "studios_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"gender" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."class_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_replaces_booking_id_bookings_id_fk" FOREIGN KEY ("replaces_booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_slot_id_class_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."class_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_slots" ADD CONSTRAINT "class_slots_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_slots" ADD CONSTRAINT "class_slots_instructor_id_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_enrollments" ADD CONSTRAINT "standing_enrollments_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_enrollments" ADD CONSTRAINT "standing_enrollments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_enrollments" ADD CONSTRAINT "standing_enrollments_slot_id_class_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."class_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agreements_student_idx" ON "agreements" USING btree ("student_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_active_session_student_uq" ON "bookings" USING btree ("session_id","student_id") WHERE "bookings"."status" = 'booked';--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_idempotency_uq" ON "bookings" USING btree ("studio_id","idempotency_key") WHERE "bookings"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "bookings_student_status_idx" ON "bookings" USING btree ("student_id","status");--> statement-breakpoint
CREATE INDEX "bookings_session_idx" ON "bookings" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "class_sessions_slot_starts_uq" ON "class_sessions" USING btree ("slot_id","starts_at");--> statement-breakpoint
CREATE INDEX "class_sessions_studio_starts_idx" ON "class_sessions" USING btree ("studio_id","starts_at");--> statement-breakpoint
CREATE INDEX "class_slots_studio_weekday_idx" ON "class_slots" USING btree ("studio_id","weekday","start_time");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_studio_user_uq" ON "memberships" USING btree ("studio_id","user_id");--> statement-breakpoint
CREATE INDEX "standing_enrollments_student_idx" ON "standing_enrollments" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "standing_enrollments_slot_idx" ON "standing_enrollments" USING btree ("slot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "students_studio_user_uq" ON "students" USING btree ("studio_id","user_id");