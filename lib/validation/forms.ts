/**
 * Form-input schemas — Zod validators applied at every Server Action
 * boundary (§0.6, §8). Each schema mirrors the corresponding service
 * input but accepts `FormData`-flavoured strings.
 */

import { z } from "zod";

import {
  ACCESS_SOURCES,
  OPERATOR_ROLES,
  WAREHOUSE_USER_STATUSES,
} from "./enums";

const optional = <T extends z.ZodType>(s: T) =>
  z.union([s, z.literal(""), z.literal(null), z.undefined()]).transform((v) =>
    v === "" || v === null || v === undefined ? undefined : (v as z.infer<T>),
  );

const isoDate = z
  .string()
  .min(1)
  .refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date");

export const CreateWarehouseUserForm = z.object({
  employeeId: z.string().min(1).max(64),
  fullName: z.string().min(1).max(200),
  email: z.string().email().optional().or(z.literal("").transform(() => undefined)),
  warehouseId: z.string().uuid(),
  roleId: z.string().uuid(),
  hireDate: isoDate,
});

export const EditWarehouseUserForm = z.object({
  id: z.string().uuid(),
  fullName: z.string().min(1).max(200),
  email: z.string().email().or(z.literal("").transform(() => null)),
  warehouseId: z.string().uuid(),
  roleId: z.string().uuid(),
});

export const ChangeStatusForm = z.object({
  id: z.string().uuid(),
  nextStatus: z.enum(WAREHOUSE_USER_STATUSES),
  reason: optional(z.string().max(500)),
});

export const GrantAccessForm = z.object({
  warehouseUserId: z.string().uuid(),
  permissionId: z.string().uuid(),
  source: z.enum(ACCESS_SOURCES),
  expiresAt: optional(isoDate),
  reason: optional(z.string().max(500)),
});

export const RevokeAccessForm = z.object({
  accessId: z.string().uuid(),
  reason: optional(z.string().max(500)),
});

export const IssueCertificateForm = z.object({
  warehouseUserId: z.string().uuid(),
  certificateId: z.string().uuid(),
  issuedAt: optional(isoDate),
  expiresAt: optional(isoDate),
  documentPath: optional(z.string().max(500)),
});

export const RenewCertificateForm = z.object({
  userCertificateId: z.string().uuid(),
});

export const RevokeCertificateForm = z.object({
  userCertificateId: z.string().uuid(),
});

export const TickChecklistItemForm = z.object({
  userChecklistItemId: z.string().uuid(),
});

export const OffboardForm = z.object({
  id: z.string().uuid(),
  reason: optional(z.string().max(500)),
});

export const ProposalReviewForm = z.object({
  proposalId: z.string().uuid(),
  note: optional(z.string().max(500)),
});

export const NlQueryForm = z.object({
  question: z.string().min(1).max(2000),
});

export const NlProvisionForm = z.object({
  text: z.string().min(1).max(2000),
});

export const CreateOperatorForm = z.object({
  email: z.string().email(),
  fullName: z.string().min(1).max(200),
  operatorRole: z.enum(OPERATOR_ROLES),
  warehouseIds: z
    .union([z.string(), z.array(z.string())])
    .transform((v) =>
      (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean),
    )
    .pipe(z.array(z.string().uuid())),
});

export const UpdateOperatorForm = z.object({
  id: z.string().uuid(),
  fullName: z.string().min(1).max(200),
  operatorRole: z.enum(OPERATOR_ROLES),
  isActive: z
    .union([z.literal("on"), z.literal("true"), z.literal("false"), z.undefined()])
    .transform((v) => v === "on" || v === "true"),
});

export const AssignWarehouseForm = z.object({
  appUserId: z.string().uuid(),
  warehouseId: z.string().uuid(),
});

export const UnassignWarehouseForm = z.object({
  appUserId: z.string().uuid(),
  warehouseId: z.string().uuid(),
});
