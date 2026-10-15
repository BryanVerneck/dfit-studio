ALTER TABLE "bookings" DROP CONSTRAINT "bookings_cancel_reason_ck";--> statement-breakpoint
ALTER TABLE "class_sessions" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "class_sessions" ADD COLUMN "cancel_note" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancel_reason_ck" CHECK ("bookings"."cancel_reason" IS NULL OR "bookings"."cancel_reason" IN ('student', 'staff', 'swap', 'enrollment_ended', 'class_cancelled'));