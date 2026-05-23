/**
 * Unit tests for every rule type (§11).
 *
 * Pure — no DB, no LLM. Builds a synthetic WarehouseUserContext per test
 * and asserts on the Finding[] returned by each rule.
 */

import { describe, expect, it } from "vitest";

import { RULES_VERSION } from "@/lib/rules/config";
import {
  ruleCertificateGate,
  ruleDormantAccess,
  ruleOffboardingSla,
  ruleSegregationOfDuties,
  ruleTemporaryAccessExpiry,
} from "@/lib/rules/rules";
import type {
  AccessRow,
  CertRow,
  EvaluatorParams,
  WarehouseUserContext,
} from "@/lib/rules/types";

const NOW = new Date("2026-05-23T12:00:00Z");
const PARAMS: EvaluatorParams = {
  now: NOW,
  dormantDays: 90,
  offboardingSlaHours: 24,
};

function ctx(overrides: Partial<WarehouseUserContext> = {}): WarehouseUserContext {
  return {
    warehouseUserId: "u-1",
    roleCode: "forklift_operator",
    warehouseId: "w-1",
    status: "active",
    terminationDate: null,
    access: [],
    certificates: [],
    ...overrides,
  };
}

function access(o: Partial<AccessRow>): AccessRow {
  return {
    id: o.id ?? "a-1",
    permissionId: o.permissionId ?? "p-1",
    permissionCode: o.permissionCode ?? "wms.view_only",
    source: o.source ?? "role_template",
    status: o.status ?? "active",
    grantedAt: o.grantedAt ?? new Date("2024-01-01T00:00:00Z"),
    expiresAt: o.expiresAt ?? null,
    lastUsedAt: o.lastUsedAt ?? null,
  };
}

function cert(o: Partial<CertRow>): CertRow {
  return {
    id: o.id ?? "c-1",
    certificateCode: o.certificateCode ?? "forklift",
    status: o.status ?? "valid",
    expiresAt: o.expiresAt ?? null,
  };
}

// -------------------------------------------------------------
// ruleCertificateGate
// -------------------------------------------------------------

describe("ruleCertificateGate", () => {
  it("flags cert_missing when a required cert is absent", () => {
    const findings = ruleCertificateGate(
      ctx({ roleCode: "forklift_operator", certificates: [] }),
      PARAMS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe("cert_missing");
    expect(findings[0]!.ruleVersion).toBe(RULES_VERSION);
  });

  it("flags cert_expired_with_active_access when expired cert + active grant", () => {
    const findings = ruleCertificateGate(
      ctx({
        roleCode: "forklift_operator",
        access: [access({ status: "active" })],
        certificates: [cert({ certificateCode: "forklift", status: "expired" })],
      }),
      PARAMS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe("cert_expired_with_active_access");
    expect(findings[0]!.action.kind).toBe("create_proposal_revoke_access");
  });

  it("does not flag when cert is valid", () => {
    const findings = ruleCertificateGate(
      ctx({
        certificates: [cert({ certificateCode: "forklift", status: "valid" })],
      }),
      PARAMS,
    );
    expect(findings).toHaveLength(0);
  });

  it("ignores roles without certificate requirements", () => {
    const findings = ruleCertificateGate(
      ctx({ roleCode: "picker", certificates: [] }),
      PARAMS,
    );
    expect(findings).toHaveLength(0);
  });
});

// -------------------------------------------------------------
// ruleSegregationOfDuties
// -------------------------------------------------------------

describe("ruleSegregationOfDuties", () => {
  it("flags a known SoD pair when both perms are active", () => {
    const findings = ruleSegregationOfDuties(
      ctx({
        access: [
          access({
            id: "a-1",
            permissionCode: "wms.receive_inventory",
            grantedAt: new Date("2025-01-01"),
          }),
          access({
            id: "a-2",
            permissionCode: "wms.approve_adjustment",
            grantedAt: new Date("2025-06-01"),
          }),
        ],
      }),
      PARAMS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe("sod_violation");
    const action = findings[0]!.action;
    expect(action.kind).toBe("create_proposal_anomaly_flag");
    if (action.kind === "create_proposal_anomaly_flag") {
      // The most-recently-granted side is suggested for revocation.
      expect(action.suggestedAccessIdsToRevoke).toEqual(["a-2"]);
    }
  });

  it("does not flag when only one side of the pair is active", () => {
    const findings = ruleSegregationOfDuties(
      ctx({
        access: [access({ permissionCode: "wms.receive_inventory" })],
      }),
      PARAMS,
    );
    expect(findings).toHaveLength(0);
  });

  it("ignores revoked rows", () => {
    const findings = ruleSegregationOfDuties(
      ctx({
        access: [
          access({ permissionCode: "wms.receive_inventory" }),
          access({ permissionCode: "wms.approve_adjustment", status: "revoked" }),
        ],
      }),
      PARAMS,
    );
    expect(findings).toHaveLength(0);
  });
});

// -------------------------------------------------------------
// ruleTemporaryAccessExpiry
// -------------------------------------------------------------

describe("ruleTemporaryAccessExpiry", () => {
  it("flags temporary-project grants past expires_at", () => {
    const findings = ruleTemporaryAccessExpiry(
      ctx({
        access: [
          access({
            id: "a-1",
            source: "temporary_project",
            expiresAt: new Date("2026-01-01"),
          }),
        ],
      }),
      PARAMS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.action.kind).toBe("auto_expire_access");
    if (findings[0]!.action.kind === "auto_expire_access") {
      expect(findings[0]!.action.accessIds).toEqual(["a-1"]);
    }
  });

  it("does not flag manual or role_template grants past expiry", () => {
    const findings = ruleTemporaryAccessExpiry(
      ctx({
        access: [
          access({
            source: "manual",
            expiresAt: new Date("2024-01-01"),
          }),
        ],
      }),
      PARAMS,
    );
    expect(findings).toHaveLength(0);
  });

  it("does not flag temporary grants with no expiry", () => {
    const findings = ruleTemporaryAccessExpiry(
      ctx({
        access: [
          access({ source: "temporary_project", expiresAt: null }),
        ],
      }),
      PARAMS,
    );
    expect(findings).toHaveLength(0);
  });
});

// -------------------------------------------------------------
// ruleDormantAccess
// -------------------------------------------------------------

describe("ruleDormantAccess", () => {
  it("flags grants whose lastUsedAt is older than the threshold", () => {
    const findings = ruleDormantAccess(
      ctx({
        access: [
          access({
            id: "a-1",
            lastUsedAt: new Date("2025-01-01"),
            grantedAt: new Date("2024-01-01"),
          }),
        ],
      }),
      PARAMS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe("dormant_access");
  });

  it("flags never-used grants if granted before the cutoff", () => {
    const findings = ruleDormantAccess(
      ctx({
        access: [
          access({
            id: "a-1",
            lastUsedAt: null,
            grantedAt: new Date("2024-01-01"),
          }),
        ],
      }),
      PARAMS,
    );
    expect(findings).toHaveLength(1);
  });

  it("does not flag recent grants", () => {
    const findings = ruleDormantAccess(
      ctx({
        access: [
          access({
            id: "a-1",
            grantedAt: new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000),
          }),
        ],
      }),
      PARAMS,
    );
    expect(findings).toHaveLength(0);
  });
});

// -------------------------------------------------------------
// ruleOffboardingSla
// -------------------------------------------------------------

describe("ruleOffboardingSla", () => {
  it("flags an offboarded user whose termination is older than SLA AND who still has active access", () => {
    const findings = ruleOffboardingSla(
      ctx({
        status: "offboarded",
        terminationDate: new Date("2026-05-22T00:00:00Z"), // > 24h ago
        access: [access({ status: "active" })],
      }),
      PARAMS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]!.type).toBe("offboarding_sla_breach");
    expect(findings[0]!.action.kind).toBe(
      "create_proposal_offboard_completeness",
    );
  });

  it("does not flag if no active access remains", () => {
    const findings = ruleOffboardingSla(
      ctx({
        status: "offboarded",
        terminationDate: new Date("2026-05-22T00:00:00Z"),
        access: [access({ status: "revoked" })],
      }),
      PARAMS,
    );
    expect(findings).toHaveLength(0);
  });

  it("does not flag within the SLA window", () => {
    const findings = ruleOffboardingSla(
      ctx({
        status: "offboarded",
        terminationDate: new Date(NOW.getTime() - 10 * 60 * 60 * 1000),
        access: [access({ status: "active" })],
      }),
      PARAMS,
    );
    expect(findings).toHaveLength(0);
  });

  it("does not fire for non-offboarded users", () => {
    const findings = ruleOffboardingSla(
      ctx({ status: "active" }),
      PARAMS,
    );
    expect(findings).toHaveLength(0);
  });
});
