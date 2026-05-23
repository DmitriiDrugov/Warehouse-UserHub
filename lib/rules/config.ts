/**
 * Declarative rule configuration (§5).
 *
 * Lives in TypeScript and is Zod-validated on load so a typo can't quietly
 * disable a rule. The config is version-stamped so the evaluator can record
 * which version produced each finding (useful when investigating a flagged
 * proposal months later).
 *
 * To change a rule: edit this file, bump RULES_VERSION, commit. No DB
 * migration is required — config is read at evaluator startup.
 */

import { z } from "zod";

export const RULES_VERSION = "1.0.0";

// ---------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------

const CertRequirementSchema = z.object({
  roleCode: z.string().min(1),
  // certificate code(s) that the role REQUIRES (e.g. forklift_operator → forklift)
  requiredCertificateCodes: z.array(z.string().min(1)).min(1),
});

const SodPairSchema = z.object({
  // Permissions identified as "system_code.permission_code"
  a: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
  b: z.string().regex(/^[a-z_]+\.[a-z_]+$/),
  reason: z.string().min(1),
});

const ConfigSchema = z.object({
  version: z.string(),
  certificateRequirements: z.array(CertRequirementSchema),
  segregationOfDutyPairs: z.array(SodPairSchema),
});

export type RulesConfig = z.infer<typeof ConfigSchema>;
export type SodPair = z.infer<typeof SodPairSchema>;
export type CertRequirement = z.infer<typeof CertRequirementSchema>;

// ---------------------------------------------------------------------
// Default config (real values for the seeded catalogs in §9)
// ---------------------------------------------------------------------

const DEFAULT_CONFIG: RulesConfig = {
  version: RULES_VERSION,
  certificateRequirements: [
    {
      roleCode: "forklift_operator",
      requiredCertificateCodes: ["forklift"],
    },
    {
      roleCode: "lift_truck_operator",
      requiredCertificateCodes: ["forklift", "reach_truck"],
    },
    {
      roleCode: "warehouse_supervisor",
      requiredCertificateCodes: ["first_aid"],
    },
  ],
  segregationOfDutyPairs: [
    // A user who can both receive inventory and approve adjustments has
    // unilateral write power over stock counts.
    {
      a: "wms.receive_inventory",
      b: "wms.approve_adjustment",
      reason:
        "Receiving and approval-of-adjustment must be separated to prevent unilateral inventory writes.",
    },
    // Badge admin (issues badges) + WMS approver (signs off transactions)
    // would let one person both fabricate badges and approve their use.
    {
      a: "badge.admin",
      b: "wms.approve_adjustment",
      reason:
        "Badge administration and WMS approval combined enables fabricated-badge backdated approvals.",
    },
  ],
};

let cached: RulesConfig | undefined;

export function getRulesConfig(): RulesConfig {
  if (cached) return cached;
  cached = ConfigSchema.parse(DEFAULT_CONFIG);
  return cached;
}

/** Test-only: override the cached config. */
export function _setRulesConfigForTesting(cfg: RulesConfig | undefined): void {
  cached = cfg ? ConfigSchema.parse(cfg) : undefined;
}
