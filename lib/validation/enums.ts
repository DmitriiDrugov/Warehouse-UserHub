/**
 * Single source of truth for enum values used by both Drizzle (pgEnum) and Zod (z.enum).
 * Keep these as `as const` tuples so both layers can read the same literal types.
 */

export const OPERATOR_ROLES = ["viewer", "hr", "warehouse_admin"] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

export const WAREHOUSE_USER_STATUSES = [
  "pending",
  "active",
  "suspended",
  "offboarded",
] as const;
export type WarehouseUserStatus = (typeof WAREHOUSE_USER_STATUSES)[number];

export const ACCESS_SOURCES = [
  "role_template",
  "manual",
  "temporary_project",
] as const;
export type AccessSource = (typeof ACCESS_SOURCES)[number];

export const ACCESS_STATUSES = ["active", "revoked", "expired"] as const;
export type AccessStatus = (typeof ACCESS_STATUSES)[number];

export const CERTIFICATE_STATUSES = ["valid", "expired", "revoked"] as const;
export type CertificateStatus = (typeof CERTIFICATE_STATUSES)[number];

export const CHECKLIST_TYPES = ["onboarding", "offboarding"] as const;
export type ChecklistType = (typeof CHECKLIST_TYPES)[number];

export const CHECKLIST_STATUSES = ["in_progress", "completed"] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

export const PROPOSAL_TYPES = [
  "provision",
  "revoke_access",
  "anomaly_flag",
  "offboard_completeness",
] as const;
export type ProposalType = (typeof PROPOSAL_TYPES)[number];

export const PROPOSAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

export const PROPOSAL_CREATORS = ["system"] as const;
export type ProposalCreator = (typeof PROPOSAL_CREATORS)[number];

/**
 * Audit log action vocabulary. Free-form string in DB (so deterministic services
 * can introduce new action codes without migrations) — but for type-safety in
 * application code we list the known ones here.
 */
export const AUDIT_ACTIONS = [
  "warehouse_user.created",
  "warehouse_user.updated",
  "warehouse_user.status_changed",
  "warehouse_user.offboarded",
  "access.granted",
  "access.revoked",
  "access.expired",
  "access.marked_used",
  "certificate.issued",
  "certificate.renewed",
  "certificate.revoked",
  "certificate.expired",
  "checklist.instantiated",
  "checklist.item_done",
  "checklist.completed",
  "proposal.created",
  "proposal.approved",
  "proposal.rejected",
  "proposal.expired",
  "operator.created",
  "operator.updated",
  "operator.deactivated",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const DOCUMENT_TYPES = [
  "contract",
  "passport",
  "work_permit",
  "forklift_certificate",
  "health_clearance",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
