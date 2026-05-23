/**
 * Zod schemas for AI proposal payloads. The structured `payload` jsonb of
 * each `ai_proposals` row is validated against the schema below BEFORE it
 * is executed by the deterministic services layer (§6, §8).
 *
 * The AI is also asked to emit `payload` in this shape via `completeJSON`,
 * which performs the same validation BEFORE the row is even inserted.
 */

import { z } from "zod";

export const ProvisionPayload = z.object({
  employeeId: z.string().min(1),
  fullName: z.string().min(1),
  email: z.string().email().optional().nullable(),
  warehouseId: z.string().uuid(),
  roleId: z.string().uuid(),
  hireDate: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "hireDate must be an ISO date string",
  }),
  extraPermissionIds: z.array(z.string().uuid()).optional(),
  referenceWarehouseUserId: z.string().uuid().optional(),
});
export type ProvisionPayloadT = z.infer<typeof ProvisionPayload>;

export const RevokeAccessPayload = z.object({
  warehouseUserId: z.string().uuid(),
  accessIds: z.array(z.string().uuid()).min(1),
  reason: z.string().min(1),
});
export type RevokeAccessPayloadT = z.infer<typeof RevokeAccessPayload>;

export const AnomalyFlagPayload = z.object({
  warehouseUserId: z.string().uuid(),
  anomalyType: z.enum([
    "dormant_access",
    "sod_violation",
    "expired_cert_with_active_access",
    "peer_outlier",
  ]),
  details: z.record(z.string(), z.unknown()),
  suggestedAccessIdsToRevoke: z.array(z.string().uuid()).optional(),
});
export type AnomalyFlagPayloadT = z.infer<typeof AnomalyFlagPayload>;

export const OffboardCompletenessPayload = z.object({
  warehouseUserId: z.string().uuid(),
  accessIds: z.array(z.string().uuid()),
  certificateIds: z.array(z.string().uuid()),
  extras: z.array(
    z.object({
      kind: z.string().min(1),
      description: z.string().min(1),
    }),
  ),
});
export type OffboardCompletenessPayloadT = z.infer<
  typeof OffboardCompletenessPayload
>;

export const PROPOSAL_PAYLOAD_SCHEMAS = {
  provision: ProvisionPayload,
  revoke_access: RevokeAccessPayload,
  anomaly_flag: AnomalyFlagPayload,
  offboard_completeness: OffboardCompletenessPayload,
} as const;
