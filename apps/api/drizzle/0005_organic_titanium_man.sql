CREATE TABLE "standing_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"studio_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"from_enrollment_id" uuid,
	"to_slot_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text,
	"decision_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "standing_requests_status_ck" CHECK ("standing_requests"."status" IN ('pending', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "standing_requests_change_ck" CHECK ("standing_requests"."from_enrollment_id" IS NOT NULL OR "standing_requests"."to_slot_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "standing_enrollments" ADD COLUMN "allow_over_capacity" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "standing_requests" ADD CONSTRAINT "standing_requests_studio_id_studios_id_fk" FOREIGN KEY ("studio_id") REFERENCES "public"."studios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_requests" ADD CONSTRAINT "standing_requests_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_requests" ADD CONSTRAINT "standing_requests_from_enrollment_id_standing_enrollments_id_fk" FOREIGN KEY ("from_enrollment_id") REFERENCES "public"."standing_enrollments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_requests" ADD CONSTRAINT "standing_requests_to_slot_id_class_slots_id_fk" FOREIGN KEY ("to_slot_id") REFERENCES "public"."class_slots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_requests" ADD CONSTRAINT "standing_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "standing_requests_studio_status_idx" ON "standing_requests" USING btree ("studio_id","status");--> statement-breakpoint
CREATE INDEX "standing_requests_student_idx" ON "standing_requests" USING btree ("student_id");