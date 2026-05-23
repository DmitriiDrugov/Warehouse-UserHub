/**
 * Shared types for the rules engine (§5).
 *
 * A `Finding` is a structured, deterministic observation about a single
 * warehouse user. The evaluator decides how to act on each finding
 * (auto-action vs. proposal); rules themselves never call the database
 * or the LLM — they're pure functions over pre-fetched context.
 */

export type Severity = "low" | "medium" | "high";

export type FindingType =
  | "temp_access_expired"
  | "cert_missing"
  | "cert_expired_with_active_access"
  | "sod_violation"
  | "dormant_access"
  | "offboarding_sla_breach";

export type FindingAction =
  | { kind: "auto_expire_access"; accessIds: string[] }
  | {
      kind: "create_proposal_revoke_access";
      accessIds: string[];
      reason: string;
    }
  | {
      kind: "create_proposal_anomaly_flag";
      anomalyType:
        | "dormant_access"
        | "sod_violation"
        | "expired_cert_with_active_access"
        | "peer_outlier";
      suggestedAccessIdsToRevoke?: string[];
    }
  | { kind: "create_proposal_offboard_completeness" };

export type Finding = {
  type: FindingType;
  severity: Severity;
  warehouseUserId: string;
  ruleVersion: string;
  title: string;
  details: Record<string, unknown>;
  action: FindingAction;
};

/**
 * Pre-fetched context handed to every rule. The evaluator loads it once
 * per user so rules don't repeat queries.
 */
export type AccessRow = {
  id: string;
  permissionId: string;
  permissionCode: string; // "wms.receive_inventory"
  source: "role_template" | "manual" | "temporary_project";
  status: "active" | "revoked" | "expired";
  grantedAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
};

export type CertRow = {
  id: string;
  certificateCode: string;
  status: "valid" | "expired" | "revoked";
  expiresAt: Date | null;
};

export type WarehouseUserContext = {
  warehouseUserId: string;
  roleCode: string;
  warehouseId: string;
  status: "pending" | "active" | "suspended" | "offboarded";
  terminationDate: Date | null;
  access: AccessRow[];
  certificates: CertRow[];
};

export type EvaluatorParams = {
  now: Date;
  dormantDays: number;
  offboardingSlaHours: number;
};
