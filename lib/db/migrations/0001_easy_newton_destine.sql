CREATE TABLE IF NOT EXISTS "worker_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"worker_id" uuid,
	"proposal_id" uuid,
	"document_type" text NOT NULL,
	"file_name" text NOT NULL,
	"storage_path" text NOT NULL,
	"file_size_bytes" integer,
	"mime_type" text,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "worker_documents" ADD CONSTRAINT "worker_documents_worker_id_warehouse_users_id_fk" FOREIGN KEY ("worker_id") REFERENCES "public"."warehouse_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "worker_documents" ADD CONSTRAINT "worker_documents_proposal_id_ai_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."ai_proposals"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "worker_documents" ADD CONSTRAINT "worker_documents_uploaded_by_app_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worker_documents_by_worker" ON "worker_documents" USING btree ("worker_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "worker_documents_by_proposal" ON "worker_documents" USING btree ("proposal_id");
