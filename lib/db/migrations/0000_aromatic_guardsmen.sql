CREATE TYPE "public"."access_source" AS ENUM('role_template', 'manual', 'temporary_project');--> statement-breakpoint
CREATE TYPE "public"."access_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."certificate_status" AS ENUM('valid', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."checklist_status" AS ENUM('in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."checklist_type" AS ENUM('onboarding', 'offboarding');--> statement-breakpoint
CREATE TYPE "public"."operator_role" AS ENUM('viewer', 'hr', 'warehouse_admin');--> statement-breakpoint
CREATE TYPE "public"."proposal_creator" AS ENUM('system');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."proposal_type" AS ENUM('provision', 'revoke_access', 'anomaly_flag', 'offboard_completeness');--> statement-breakpoint
CREATE TYPE "public"."warehouse_user_status" AS ENUM('pending', 'active', 'suspended', 'offboarded');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "proposal_type" NOT NULL,
	"target_entity_type" text NOT NULL,
	"target_entity_id" uuid,
	"payload" jsonb NOT NULL,
	"explanation" text NOT NULL,
	"generated_query" text,
	"status" "proposal_status" DEFAULT 'pending' NOT NULL,
	"created_by" "proposal_creator" DEFAULT 'system' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_user_warehouses" (
	"app_user_id" uuid NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_warehouses_app_user_id_warehouse_id_pk" PRIMARY KEY("app_user_id","warehouse_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" uuid,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"operator_role" "operator_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"ai_assisted" boolean DEFAULT false NOT NULL,
	"proposal_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"validity_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"label" text NOT NULL,
	"order" integer NOT NULL,
	"is_required" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "checklist_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "checklist_type" NOT NULL,
	"role_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "systems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_user_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"source" "access_source" NOT NULL,
	"status" "access_status" DEFAULT 'active' NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_user_id" uuid NOT NULL,
	"certificate_id" uuid NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"status" "certificate_status" DEFAULT 'valid' NOT NULL,
	"document_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_checklist_id" uuid NOT NULL,
	"checklist_item_id" uuid NOT NULL,
	"is_done" boolean DEFAULT false NOT NULL,
	"done_by" uuid,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_user_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"type" "checklist_type" NOT NULL,
	"status" "checklist_status" DEFAULT 'in_progress' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warehouse_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" text NOT NULL,
	"full_name" text NOT NULL,
	"email" text,
	"warehouse_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"status" "warehouse_user_status" DEFAULT 'pending' NOT NULL,
	"hire_date" date NOT NULL,
	"termination_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "warehouses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"location" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_proposals" ADD CONSTRAINT "ai_proposals_reviewed_by_app_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app_user_warehouses" ADD CONSTRAINT "app_user_warehouses_app_user_id_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "app_user_warehouses" ADD CONSTRAINT "app_user_warehouses_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_app_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_proposal_id_ai_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."ai_proposals"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_template_id_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "permissions" ADD CONSTRAINT "permissions_system_id_systems_id_fk" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_access" ADD CONSTRAINT "user_access_warehouse_user_id_warehouse_users_id_fk" FOREIGN KEY ("warehouse_user_id") REFERENCES "public"."warehouse_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_access" ADD CONSTRAINT "user_access_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_access" ADD CONSTRAINT "user_access_granted_by_app_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_access" ADD CONSTRAINT "user_access_revoked_by_app_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_certificates" ADD CONSTRAINT "user_certificates_warehouse_user_id_warehouse_users_id_fk" FOREIGN KEY ("warehouse_user_id") REFERENCES "public"."warehouse_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_certificates" ADD CONSTRAINT "user_certificates_certificate_id_certificates_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "public"."certificates"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_checklist_items" ADD CONSTRAINT "user_checklist_items_user_checklist_id_user_checklists_id_fk" FOREIGN KEY ("user_checklist_id") REFERENCES "public"."user_checklists"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_checklist_items" ADD CONSTRAINT "user_checklist_items_checklist_item_id_checklist_items_id_fk" FOREIGN KEY ("checklist_item_id") REFERENCES "public"."checklist_items"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_checklist_items" ADD CONSTRAINT "user_checklist_items_done_by_app_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."app_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_checklists" ADD CONSTRAINT "user_checklists_warehouse_user_id_warehouse_users_id_fk" FOREIGN KEY ("warehouse_user_id") REFERENCES "public"."warehouse_users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_checklists" ADD CONSTRAINT "user_checklists_template_id_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warehouse_users" ADD CONSTRAINT "warehouse_users_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warehouse_users" ADD CONSTRAINT "warehouse_users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_proposals_by_status" ON "ai_proposals" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_proposals_by_type" ON "ai_proposals" USING btree ("type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_proposals_by_target" ON "ai_proposals" USING btree ("target_entity_type","target_entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "app_user_warehouses_by_warehouse" ON "app_user_warehouses" USING btree ("warehouse_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_users_email_unique" ON "app_users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "app_users_auth_user_id_unique" ON "app_users" USING btree ("auth_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_by_entity" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_by_actor" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_by_proposal" ON "audit_log" USING btree ("proposal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_by_created_at" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "certificates_code_unique" ON "certificates" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "checklist_items_by_template" ON "checklist_items" USING btree ("template_id","order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "checklist_templates_by_type_role" ON "checklist_templates" USING btree ("type","role_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "permissions_system_code_unique" ON "permissions" USING btree ("system_id","code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "permissions_by_system" ON "permissions" USING btree ("system_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "role_permissions_by_permission" ON "role_permissions" USING btree ("permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "roles_code_unique" ON "roles" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "systems_code_unique" ON "systems" USING btree ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_access_by_warehouse_user" ON "user_access" USING btree ("warehouse_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_access_by_permission" ON "user_access" USING btree ("permission_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_access_by_status" ON "user_access" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_access_by_expires_at" ON "user_access" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_access_by_last_used_at" ON "user_access" USING btree ("last_used_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_access_by_status_expires" ON "user_access" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_certificates_by_warehouse_user" ON "user_certificates" USING btree ("warehouse_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_certificates_by_certificate" ON "user_certificates" USING btree ("certificate_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_certificates_by_expires_at" ON "user_certificates" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_certificates_by_status" ON "user_certificates" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_checklist_items_by_user_checklist" ON "user_checklist_items" USING btree ("user_checklist_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_checklists_by_warehouse_user" ON "user_checklists" USING btree ("warehouse_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_checklists_by_status" ON "user_checklists" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "warehouse_users_employee_id_unique" ON "warehouse_users" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_users_by_warehouse" ON "warehouse_users" USING btree ("warehouse_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_users_by_status" ON "warehouse_users" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warehouse_users_by_role" ON "warehouse_users" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "warehouses_code_unique" ON "warehouses" USING btree ("code");