-- =====================================================================
-- 0001_security_extras.sql
-- Hand-written companion to the drizzle-generated schema migrations.
-- Applied by lib/db/migrate.ts AFTER `drizzle-orm/postgres-js/migrator`.
--
-- Contains (§4, §6.1, §8):
--   1. helper functions for RLS (current_operator_id, current_operator_role,
--      has_warehouse_access)
--   2. roles: `app_operator` (non-BYPASSRLS, used by withOperator) and
--      `nl_query_reader` (SELECT-only on the reporting views, used by
--      the NL→SQL pipeline)
--   3. RLS enabled on every authorization-relevant table + policies
--   4. updated_at trigger applied to every table that has updated_at
--   5. audit_log append-only trigger (rejects UPDATE/DELETE for everyone)
--   6. partial unique index on user_access ensuring at most one active grant
--      per (warehouse_user, permission)
--   7. reporting VIEWs that are the ONLY surface visible to the NL→SQL LLM
--
-- This file MUST be idempotent — every CREATE uses IF NOT EXISTS or a
-- DO $$ ... duplicate_object handler. It re-runs cleanly on every migrate.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Helper functions
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_operator_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT NULLIF(current_setting('app.operator_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION public.current_operator_role() RETURNS operator_role
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT operator_role
    FROM public.app_users
   WHERE id = public.current_operator_id()
     AND is_active = true
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.has_warehouse_access(p_warehouse_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.app_user_warehouses
     WHERE app_user_id = public.current_operator_id()
       AND warehouse_id = p_warehouse_id
  ) OR public.current_operator_role() = 'warehouse_admin'
$$;

-- has_warehouse_user_access(p_id): does the current operator see this warehouse_user?
CREATE OR REPLACE FUNCTION public.has_warehouse_user_access(p_warehouse_user_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.warehouse_users wu
     WHERE wu.id = p_warehouse_user_id
       AND public.has_warehouse_access(wu.warehouse_id)
  )
$$;

CREATE OR REPLACE FUNCTION public.is_active_operator() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.current_operator_role() IS NOT NULL
$$;

-- ---------------------------------------------------------------------
-- 2. Roles
-- ---------------------------------------------------------------------

-- app_operator: non-login, non-BYPASSRLS. Used by SET LOCAL ROLE inside
-- transactions opened via withOperator().
DO $$ BEGIN
  CREATE ROLE app_operator NOLOGIN NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- nl_query_reader: login role for the NL→SQL pipeline. SELECT only on the
-- reporting views. The README documents how to set its password after
-- migration so it can be used by DATABASE_URL_READONLY.
DO $$ BEGIN
  CREATE ROLE nl_query_reader LOGIN NOINHERIT
    CONNECTION LIMIT 5;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT USAGE ON SCHEMA public TO app_operator, nl_query_reader;

-- Allow the connecting role (typically `postgres` on Supabase) to switch into
-- `app_operator` via SET LOCAL ROLE inside withOperator() transactions, and
-- into `nl_query_reader` inside RLS tests. Without these GRANTs the connecting
-- role cannot impersonate the per-tenant role at all.
DO $$ BEGIN
  EXECUTE format('GRANT app_operator TO %I', current_user);
  EXECUTE format('GRANT nl_query_reader TO %I', current_user);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Make all current and future tables RLS-respect the app_operator role.
-- (postgres owner of the tables still bypasses RLS; that's intentional
-- for the admin connection and the seed/migration scripts.)

-- App-operator: full DML on most tables; INSERT-only on audit_log; SELECT+UPDATE on ai_proposals.
GRANT SELECT, INSERT, UPDATE, DELETE ON
    public.warehouses,
    public.app_users,
    public.app_user_warehouses,
    public.roles,
    public.systems,
    public.permissions,
    public.role_permissions,
    public.warehouse_users,
    public.user_access,
    public.certificates,
    public.user_certificates,
    public.checklist_templates,
    public.checklist_items,
    public.user_checklists,
    public.user_checklist_items
  TO app_operator;

-- audit_log: SELECT + INSERT only. UPDATE/DELETE blocked by trigger AND
-- by the absence of the grant (defense in depth).
GRANT SELECT, INSERT ON public.audit_log TO app_operator;

-- ai_proposals: SELECT + UPDATE (for approve/reject). INSERT only by the
-- admin role (the AI subsystem runs system-side jobs via dbAdmin).
GRANT SELECT, UPDATE ON public.ai_proposals TO app_operator;

-- Make sure sequences (if any get added later) are usable.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_operator;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_operator;

-- ---------------------------------------------------------------------
-- 3. RLS enable + policies
-- ---------------------------------------------------------------------

-- Convenience macro: every policy below assumes the current role is
-- app_operator OR a superuser (postgres bypasses RLS anyway). We do
-- *not* try to defend against malicious superusers — that's outside
-- the threat model.

-- ---- warehouses ----
ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS warehouses_select ON public.warehouses;
CREATE POLICY warehouses_select ON public.warehouses FOR SELECT
  USING (public.has_warehouse_access(id));
DROP POLICY IF EXISTS warehouses_modify ON public.warehouses;
CREATE POLICY warehouses_modify ON public.warehouses FOR ALL
  USING (public.current_operator_role() = 'warehouse_admin')
  WITH CHECK (public.current_operator_role() = 'warehouse_admin');

-- ---- app_users ----
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_users_select ON public.app_users;
-- Any active operator can see other operators (needed for "granted_by"
-- display, reviewer name, etc.) — no PII beyond name/email/role.
CREATE POLICY app_users_select ON public.app_users FOR SELECT
  USING (public.is_active_operator());
DROP POLICY IF EXISTS app_users_modify ON public.app_users;
CREATE POLICY app_users_modify ON public.app_users FOR ALL
  USING (public.current_operator_role() = 'warehouse_admin')
  WITH CHECK (public.current_operator_role() = 'warehouse_admin');

-- ---- app_user_warehouses ----
ALTER TABLE public.app_user_warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_user_warehouses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_user_warehouses_select ON public.app_user_warehouses;
CREATE POLICY app_user_warehouses_select ON public.app_user_warehouses FOR SELECT
  USING (
    app_user_id = public.current_operator_id()
    OR public.current_operator_role() = 'warehouse_admin'
  );
DROP POLICY IF EXISTS app_user_warehouses_modify ON public.app_user_warehouses;
CREATE POLICY app_user_warehouses_modify ON public.app_user_warehouses FOR ALL
  USING (public.current_operator_role() = 'warehouse_admin')
  WITH CHECK (public.current_operator_role() = 'warehouse_admin');

-- ---- Catalog tables (read-only for non-admins) ----
-- roles, systems, permissions, role_permissions, certificates,
-- checklist_templates, checklist_items
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'roles', 'systems', 'permissions', 'role_permissions',
    'certificates', 'checklist_templates', 'checklist_items'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I_select ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_select ON public.%I FOR SELECT USING (public.is_active_operator())',
      t, t
    );
    EXECUTE format('DROP POLICY IF EXISTS %I_modify ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY %I_modify ON public.%I FOR ALL USING (public.current_operator_role() = ''warehouse_admin'') WITH CHECK (public.current_operator_role() = ''warehouse_admin'')',
      t, t
    );
  END LOOP;
END $$;

-- ---- warehouse_users ----
ALTER TABLE public.warehouse_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warehouse_users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS warehouse_users_select ON public.warehouse_users;
CREATE POLICY warehouse_users_select ON public.warehouse_users FOR SELECT
  USING (public.has_warehouse_access(warehouse_id));
DROP POLICY IF EXISTS warehouse_users_insert ON public.warehouse_users;
CREATE POLICY warehouse_users_insert ON public.warehouse_users FOR INSERT
  WITH CHECK (
    public.current_operator_role() IN ('hr', 'warehouse_admin')
    AND public.has_warehouse_access(warehouse_id)
  );
DROP POLICY IF EXISTS warehouse_users_update ON public.warehouse_users;
CREATE POLICY warehouse_users_update ON public.warehouse_users FOR UPDATE
  USING (
    public.current_operator_role() IN ('hr', 'warehouse_admin')
    AND public.has_warehouse_access(warehouse_id)
  )
  WITH CHECK (public.has_warehouse_access(warehouse_id));
DROP POLICY IF EXISTS warehouse_users_delete ON public.warehouse_users;
CREATE POLICY warehouse_users_delete ON public.warehouse_users FOR DELETE
  USING (public.current_operator_role() = 'warehouse_admin');

-- ---- user_access ----
ALTER TABLE public.user_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_access FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_access_select ON public.user_access;
CREATE POLICY user_access_select ON public.user_access FOR SELECT
  USING (public.has_warehouse_user_access(warehouse_user_id));
DROP POLICY IF EXISTS user_access_insert ON public.user_access;
CREATE POLICY user_access_insert ON public.user_access FOR INSERT
  WITH CHECK (
    public.current_operator_role() IN ('hr', 'warehouse_admin')
    AND public.has_warehouse_user_access(warehouse_user_id)
  );
DROP POLICY IF EXISTS user_access_update ON public.user_access;
CREATE POLICY user_access_update ON public.user_access FOR UPDATE
  USING (
    public.current_operator_role() IN ('hr', 'warehouse_admin')
    AND public.has_warehouse_user_access(warehouse_user_id)
  )
  WITH CHECK (public.has_warehouse_user_access(warehouse_user_id));
DROP POLICY IF EXISTS user_access_delete ON public.user_access;
CREATE POLICY user_access_delete ON public.user_access FOR DELETE
  USING (public.current_operator_role() = 'warehouse_admin');

-- ---- user_certificates ----
ALTER TABLE public.user_certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_certificates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_certificates_select ON public.user_certificates;
CREATE POLICY user_certificates_select ON public.user_certificates FOR SELECT
  USING (public.has_warehouse_user_access(warehouse_user_id));
DROP POLICY IF EXISTS user_certificates_modify ON public.user_certificates;
CREATE POLICY user_certificates_modify ON public.user_certificates FOR ALL
  USING (
    public.current_operator_role() IN ('hr', 'warehouse_admin')
    AND public.has_warehouse_user_access(warehouse_user_id)
  )
  WITH CHECK (public.has_warehouse_user_access(warehouse_user_id));

-- ---- user_checklists ----
ALTER TABLE public.user_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_checklists FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_checklists_select ON public.user_checklists;
CREATE POLICY user_checklists_select ON public.user_checklists FOR SELECT
  USING (public.has_warehouse_user_access(warehouse_user_id));
DROP POLICY IF EXISTS user_checklists_modify ON public.user_checklists;
CREATE POLICY user_checklists_modify ON public.user_checklists FOR ALL
  USING (
    public.current_operator_role() IN ('hr', 'warehouse_admin')
    AND public.has_warehouse_user_access(warehouse_user_id)
  )
  WITH CHECK (public.has_warehouse_user_access(warehouse_user_id));

-- ---- user_checklist_items ----
ALTER TABLE public.user_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_checklist_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_checklist_items_select ON public.user_checklist_items;
CREATE POLICY user_checklist_items_select ON public.user_checklist_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.user_checklists uc
     WHERE uc.id = user_checklist_id
       AND public.has_warehouse_user_access(uc.warehouse_user_id)
  ));
DROP POLICY IF EXISTS user_checklist_items_modify ON public.user_checklist_items;
CREATE POLICY user_checklist_items_modify ON public.user_checklist_items FOR ALL
  USING (
    public.current_operator_role() IN ('hr', 'warehouse_admin')
    AND EXISTS (
      SELECT 1 FROM public.user_checklists uc
       WHERE uc.id = user_checklist_id
         AND public.has_warehouse_user_access(uc.warehouse_user_id)
    )
  )
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.user_checklists uc
     WHERE uc.id = user_checklist_id
       AND public.has_warehouse_user_access(uc.warehouse_user_id)
  ));

-- ---- ai_proposals ----
ALTER TABLE public.ai_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_proposals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_proposals_select ON public.ai_proposals;
CREATE POLICY ai_proposals_select ON public.ai_proposals FOR SELECT
  USING (public.is_active_operator());
-- INSERT happens only via dbAdmin (postgres, bypass) from cron/AI jobs.
-- No INSERT policy granted to app_operator (the grant excludes INSERT).
DROP POLICY IF EXISTS ai_proposals_update ON public.ai_proposals;
CREATE POLICY ai_proposals_update ON public.ai_proposals FOR UPDATE
  USING (public.current_operator_role() = 'warehouse_admin')
  WITH CHECK (public.current_operator_role() = 'warehouse_admin');

-- ---- audit_log ----
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_log_select ON public.audit_log;
CREATE POLICY audit_log_select ON public.audit_log FOR SELECT
  USING (public.is_active_operator());
DROP POLICY IF EXISTS audit_log_insert ON public.audit_log;
CREATE POLICY audit_log_insert ON public.audit_log FOR INSERT
  WITH CHECK (
    public.is_active_operator()
    AND actor_id = public.current_operator_id()
  );
-- UPDATE/DELETE: blocked by trigger below AND by absent grant.

-- ---------------------------------------------------------------------
-- 3a. Tighten FK on audit_log.proposal_id from SET NULL to RESTRICT
--     SET NULL would issue an UPDATE on the audit row, which the
--     append-only trigger correctly rejects. RESTRICT preserves the
--     audit trail (you cannot delete a proposal that still has audit
--     entries pointing at it).
-- ---------------------------------------------------------------------

DO $$
DECLARE
  fk_name text;
BEGIN
  SELECT conname INTO fk_name
    FROM pg_constraint
   WHERE conrelid = 'public.audit_log'::regclass
     AND contype = 'f'
     AND conname LIKE 'audit_log_proposal_id_%';
  IF fk_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.audit_log DROP CONSTRAINT %I',
      fk_name
    );
  END IF;
  -- (Re)create with RESTRICT semantics. Idempotent: if the name we want
  -- to create already exists from a prior run with the correct action,
  -- pg_constraint already had it and we skipped above.
  BEGIN
    ALTER TABLE public.audit_log
      ADD CONSTRAINT audit_log_proposal_id_fkey
      FOREIGN KEY (proposal_id) REFERENCES public.ai_proposals(id) ON DELETE RESTRICT;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ---------------------------------------------------------------------
-- 4. updated_at trigger
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'warehouses', 'app_users', 'roles', 'systems', 'permissions',
    'warehouse_users', 'user_access', 'certificates', 'user_certificates',
    'checklist_templates', 'user_checklists', 'ai_proposals'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_set_updated_at ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_updated_at()',
      t, t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 5. audit_log append-only trigger
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.audit_log_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only; % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER IF EXISTS audit_log_no_update ON public.audit_log;
CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_reject_mutation();

DROP TRIGGER IF EXISTS audit_log_no_delete ON public.audit_log;
CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_reject_mutation();

-- TRUNCATE bypasses row triggers; use a statement trigger.
DROP TRIGGER IF EXISTS audit_log_no_truncate ON public.audit_log;
CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON public.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION public.audit_log_reject_mutation();

-- ---------------------------------------------------------------------
-- 6. Partial unique index on user_access
-- ---------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS user_access_unique_active
  ON public.user_access (warehouse_user_id, permission_id)
  WHERE status = 'active';

-- ---------------------------------------------------------------------
-- 7. Reporting views for the NL→SQL pipeline (§6.1)
-- These are the ONLY surface visible to the LLM. The LLM prompt is built
-- from these definitions; the AST validator allows only these names.
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_warehouse_users AS
SELECT
  wu.id                       AS warehouse_user_id,
  wu.employee_id,
  wu.full_name,
  wu.email,
  w.code                      AS warehouse_code,
  w.name                      AS warehouse_name,
  r.code                      AS role_code,
  r.name                      AS role_name,
  wu.status,
  wu.hire_date,
  wu.termination_date
FROM public.warehouse_users wu
JOIN public.warehouses w ON w.id = wu.warehouse_id
JOIN public.roles r ON r.id = wu.role_id;

COMMENT ON VIEW public.v_warehouse_users IS
  'One row per warehouse user. Includes warehouse and role denormalized.';

CREATE OR REPLACE VIEW public.v_user_access AS
SELECT
  ua.id                       AS access_id,
  wu.id                       AS warehouse_user_id,
  wu.employee_id,
  wu.full_name,
  w.code                      AS warehouse_code,
  r.code                      AS role_code,
  s.code                      AS system_code,
  s.name                      AS system_name,
  p.code                      AS permission_code,
  p.name                      AS permission_name,
  ua.source,
  ua.status,
  ua.granted_at,
  ua.expires_at,
  ua.last_used_at,
  ua.revoked_at
FROM public.user_access ua
JOIN public.warehouse_users wu ON wu.id = ua.warehouse_user_id
JOIN public.warehouses w ON w.id = wu.warehouse_id
JOIN public.roles r ON r.id = wu.role_id
JOIN public.permissions p ON p.id = ua.permission_id
JOIN public.systems s ON s.id = p.system_id;

COMMENT ON VIEW public.v_user_access IS
  'One row per access grant. Includes warehouse user, role, system and permission denormalized.';

CREATE OR REPLACE VIEW public.v_user_certificates AS
SELECT
  uc.id                       AS user_certificate_id,
  wu.id                       AS warehouse_user_id,
  wu.employee_id,
  wu.full_name,
  w.code                      AS warehouse_code,
  c.code                      AS certificate_code,
  c.name                      AS certificate_name,
  uc.issued_at,
  uc.expires_at,
  uc.status,
  (uc.expires_at IS NOT NULL AND uc.expires_at < now()) AS is_expired
FROM public.user_certificates uc
JOIN public.warehouse_users wu ON wu.id = uc.warehouse_user_id
JOIN public.warehouses w ON w.id = wu.warehouse_id
JOIN public.certificates c ON c.id = uc.certificate_id;

COMMENT ON VIEW public.v_user_certificates IS
  'One row per certificate issuance. is_expired is a convenience boolean.';

CREATE OR REPLACE VIEW public.v_checklist_progress AS
SELECT
  uc.id                       AS user_checklist_id,
  wu.id                       AS warehouse_user_id,
  wu.employee_id,
  wu.full_name,
  w.code                      AS warehouse_code,
  ct.name                     AS template_name,
  uc.type,
  uc.status,
  uc.started_at,
  uc.completed_at,
  COUNT(uci.id) FILTER (WHERE uci.is_done)            AS items_done,
  COUNT(uci.id)                                       AS items_total,
  COUNT(uci.id) FILTER (WHERE NOT uci.is_done AND ci.is_required) AS required_remaining
FROM public.user_checklists uc
JOIN public.warehouse_users wu ON wu.id = uc.warehouse_user_id
JOIN public.warehouses w ON w.id = wu.warehouse_id
JOIN public.checklist_templates ct ON ct.id = uc.template_id
LEFT JOIN public.user_checklist_items uci ON uci.user_checklist_id = uc.id
LEFT JOIN public.checklist_items ci ON ci.id = uci.checklist_item_id
GROUP BY uc.id, wu.id, w.code, ct.name;

COMMENT ON VIEW public.v_checklist_progress IS
  'One row per checklist instance with counters for completed and remaining items.';

CREATE OR REPLACE VIEW public.v_audit_recent AS
SELECT
  al.id              AS audit_id,
  al.entity_type,
  al.entity_id,
  al.action,
  au.email           AS actor_email,
  au.full_name       AS actor_name,
  al.ai_assisted,
  al.proposal_id,
  al.reason,
  al.created_at
FROM public.audit_log al
JOIN public.app_users au ON au.id = al.actor_id
WHERE al.created_at >= now() - interval '180 days';

COMMENT ON VIEW public.v_audit_recent IS
  'Audit entries from the last 180 days, joined with actor identity for readability.';

-- Grant SELECT on the reporting views (and ONLY those) to nl_query_reader.
GRANT SELECT ON
  public.v_warehouse_users,
  public.v_user_access,
  public.v_user_certificates,
  public.v_checklist_progress,
  public.v_audit_recent
TO nl_query_reader;

-- Required for views to actually execute the underlying SELECT under
-- nl_query_reader: grant SELECT on the underlying tables. Because the role
-- has no policies that pass and tables have RLS forced... that would block
-- it. Solution: views are owned by `postgres` and use SECURITY INVOKER by
-- default — to let nl_query_reader read, mark them SECURITY INVOKER but
-- give the role explicit SELECT on the underlying tables AND a policy that
-- always allows it. Simpler: switch the views to security_invoker=false
-- (security_definer-style behavior) so they query as their owner (postgres,
-- which bypasses RLS). Available in Postgres 15+ (Supabase is 15/16).
ALTER VIEW public.v_warehouse_users SET (security_invoker = false);
ALTER VIEW public.v_user_access SET (security_invoker = false);
ALTER VIEW public.v_user_certificates SET (security_invoker = false);
ALTER VIEW public.v_checklist_progress SET (security_invoker = false);
ALTER VIEW public.v_audit_recent SET (security_invoker = false);

-- Defense in depth: explicitly REVOKE everything else from nl_query_reader.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM nl_query_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM nl_query_reader;
REVOKE CREATE ON SCHEMA public FROM nl_query_reader;
-- Re-grant just the views.
GRANT SELECT ON
  public.v_warehouse_users,
  public.v_user_access,
  public.v_user_certificates,
  public.v_checklist_progress,
  public.v_audit_recent
TO nl_query_reader;

-- Statement timeout default for the read-only role (defense in depth;
-- the application also sets `statement_timeout` per-query).
ALTER ROLE nl_query_reader SET statement_timeout = '5s';

-- ---------------------------------------------------------------------
-- End of 0001_security_extras.sql
-- ---------------------------------------------------------------------
