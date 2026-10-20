ALTER TABLE "agreements" DROP CONSTRAINT "agreements_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_replaces_booking_id_bookings_id_fk";
--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_created_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "class_slots" DROP CONSTRAINT "class_slots_instructor_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "refresh_tokens" DROP CONSTRAINT "refresh_tokens_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "standing_enrollments" DROP CONSTRAINT "standing_enrollments_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "standing_requests" DROP CONSTRAINT "standing_requests_student_id_students_id_fk";
--> statement-breakpoint
ALTER TABLE "standing_requests" DROP CONSTRAINT "standing_requests_from_enrollment_id_standing_enrollments_id_fk";
--> statement-breakpoint
ALTER TABLE "standing_requests" DROP CONSTRAINT "standing_requests_decided_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "students" DROP CONSTRAINT "students_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_replaces_booking_id_bookings_id_fk" FOREIGN KEY ("replaces_booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_slots" ADD CONSTRAINT "class_slots_instructor_id_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_enrollments" ADD CONSTRAINT "standing_enrollments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_requests" ADD CONSTRAINT "standing_requests_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_requests" ADD CONSTRAINT "standing_requests_from_enrollment_id_standing_enrollments_id_fk" FOREIGN KEY ("from_enrollment_id") REFERENCES "public"."standing_enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_requests" ADD CONSTRAINT "standing_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE FUNCTION "release_seat_on_booking_delete"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'cancelled' THEN
    UPDATE "class_sessions" SET "booked_count" = GREATEST("booked_count" - 1, 0) WHERE "id" = OLD."session_id";
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "bookings_release_seat_on_delete" AFTER DELETE ON "bookings" FOR EACH ROW EXECUTE FUNCTION "release_seat_on_booking_delete"();
