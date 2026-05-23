/**
 * Curated reporting-view catalog for the NL→SQL pipeline (§6.1).
 *
 * Two responsibilities:
 *   1. Build the prompt — column descriptions are shown to the LLM.
 *   2. Drive the allowlist — the AST validator only accepts FROM/JOIN
 *      references that name one of these views.
 *
 * Underlying tables are NOT mentioned to the LLM. The `nl_query_reader`
 * Postgres role has SELECT only on these views (see 0001_security_extras.sql).
 */

export type ColumnSpec = {
  name: string;
  type: string;
  notes?: string;
};

export type ViewSpec = {
  name: string;
  description: string;
  columns: ColumnSpec[];
};

export const NL_VIEWS: ReadonlyArray<ViewSpec> = [
  {
    name: "v_warehouse_users",
    description: "One row per warehouse worker. Joined with warehouse + role.",
    columns: [
      { name: "warehouse_user_id", type: "uuid" },
      { name: "employee_id", type: "text" },
      { name: "full_name", type: "text" },
      { name: "email", type: "text" },
      { name: "warehouse_code", type: "text", notes: "e.g. WH-A" },
      { name: "warehouse_name", type: "text" },
      { name: "role_code", type: "text", notes: "e.g. forklift_operator" },
      { name: "role_name", type: "text" },
      {
        name: "status",
        type: "text",
        notes: "pending | active | suspended | offboarded",
      },
      { name: "hire_date", type: "date" },
      { name: "termination_date", type: "date" },
    ],
  },
  {
    name: "v_user_access",
    description: "One row per access grant.",
    columns: [
      { name: "access_id", type: "uuid" },
      { name: "warehouse_user_id", type: "uuid" },
      { name: "employee_id", type: "text" },
      { name: "full_name", type: "text" },
      { name: "warehouse_code", type: "text" },
      { name: "role_code", type: "text" },
      { name: "system_code", type: "text", notes: "wms | badge | email | shared_account | …" },
      { name: "system_name", type: "text" },
      { name: "permission_code", type: "text" },
      { name: "permission_name", type: "text" },
      {
        name: "source",
        type: "text",
        notes: "role_template | manual | temporary_project",
      },
      {
        name: "status",
        type: "text",
        notes: "active | revoked | expired",
      },
      { name: "granted_at", type: "timestamptz" },
      { name: "expires_at", type: "timestamptz" },
      { name: "last_used_at", type: "timestamptz" },
      { name: "revoked_at", type: "timestamptz" },
    ],
  },
  {
    name: "v_user_certificates",
    description: "One row per certificate issuance.",
    columns: [
      { name: "user_certificate_id", type: "uuid" },
      { name: "warehouse_user_id", type: "uuid" },
      { name: "employee_id", type: "text" },
      { name: "full_name", type: "text" },
      { name: "warehouse_code", type: "text" },
      { name: "certificate_code", type: "text", notes: "forklift | first_aid | …" },
      { name: "certificate_name", type: "text" },
      { name: "issued_at", type: "timestamptz" },
      { name: "expires_at", type: "timestamptz" },
      {
        name: "status",
        type: "text",
        notes: "valid | expired | revoked",
      },
      { name: "is_expired", type: "boolean", notes: "convenience: expires_at < now()" },
    ],
  },
  {
    name: "v_checklist_progress",
    description: "One row per checklist instance with completion counters.",
    columns: [
      { name: "user_checklist_id", type: "uuid" },
      { name: "warehouse_user_id", type: "uuid" },
      { name: "employee_id", type: "text" },
      { name: "full_name", type: "text" },
      { name: "warehouse_code", type: "text" },
      { name: "template_name", type: "text" },
      { name: "type", type: "text", notes: "onboarding | offboarding" },
      { name: "status", type: "text", notes: "in_progress | completed" },
      { name: "started_at", type: "timestamptz" },
      { name: "completed_at", type: "timestamptz" },
      { name: "items_done", type: "integer" },
      { name: "items_total", type: "integer" },
      { name: "required_remaining", type: "integer" },
    ],
  },
  {
    name: "v_audit_recent",
    description: "Audit entries from the last 180 days with the actor joined in.",
    columns: [
      { name: "audit_id", type: "uuid" },
      { name: "entity_type", type: "text" },
      { name: "entity_id", type: "uuid" },
      { name: "action", type: "text", notes: "e.g. access.granted, certificate.issued" },
      { name: "actor_email", type: "text" },
      { name: "actor_name", type: "text" },
      { name: "ai_assisted", type: "boolean" },
      { name: "proposal_id", type: "uuid" },
      { name: "reason", type: "text" },
      { name: "created_at", type: "timestamptz" },
    ],
  },
] as const;

export const NL_VIEW_NAMES: ReadonlySet<string> = new Set(
  NL_VIEWS.map((v) => v.name),
);

export function describeViewsForPrompt(): string {
  return NL_VIEWS.map((v) => {
    const cols = v.columns
      .map(
        (c) =>
          `  ${c.name} ${c.type}${c.notes ? `  -- ${c.notes}` : ""}`,
      )
      .join("\n");
    return `-- ${v.description}\nCREATE VIEW ${v.name} (\n${cols}\n);`;
  }).join("\n\n");
}
