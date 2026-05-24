/**
 * §6.3 — Natural-language provisioning.
 *
 * "Create a forklift operator at warehouse B with the same access as Péter."
 *
 *   parseProvisioningIntent(text)  → ProvisionPayloadT (validated)
 *   proposeProvision(text)         → AiProposal (status='pending')
 *
 * The deterministic execution path is `approveProposal` in lib/services/proposals.ts.
 */

import { and, asc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";

import { dbAdmin, dbReadonly } from "../db/client";
import {
  permissions,
  roles,
  systems,
  userAccess,
  warehouseUsers,
  warehouses,
} from "../db/schema";
import { getLLM } from "../llm";
import { createProposal } from "../services/proposals";
import { ProvisionPayload, type ProvisionPayloadT } from "../validation/proposals";

export type ProvisioningContext = {
  warehouses: { code: string; name: string; location: string | null }[];
  roles: { code: string; name: string; description: string | null }[];
};

const IntentSchema = z.object({
  employeeId: z.string().min(1),
  fullName: z.string().min(1),
  email: z.string().email().nullable().optional(),
  warehouseCode: z.string().min(1),
  roleCode: z.string().min(1),
  hireDate: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), "hireDate must be ISO date"),
  referenceEmployeeId: z.string().min(1).nullable().optional(),
  extraPermissionCodes: z
    .array(
      z
        .string()
        .regex(/^[a-z_]+\.[a-z_]+$/, "permission must be system_code.permission_code"),
    )
    .optional(),
});
type Intent = z.infer<typeof IntentSchema>;

export function buildSystemPrompt(ctx: ProvisioningContext): string {
  const today = new Date().toISOString().slice(0, 10);

  const warehouseList = ctx.warehouses
    .map((w) => `  ${w.code} | ${w.name}${w.location ? ` | ${w.location}` : ""}`)
    .join("\n");

  const roleList = ctx.roles
    .map((r) => `  ${r.code} | ${r.name}${r.description ? ` | ${r.description}` : ""}`)
    .join("\n");

  return [
    "You convert a provisioning request (written in any language) into a JSON object.",
    "Schema:",
    '{ employeeId: string, fullName: string, email?: string, warehouseCode: string, roleCode: string, hireDate: ISO date string, referenceEmployeeId?: string, extraPermissionCodes?: string[] ("system_code.permission_code") }',
    "",
    "Available warehouses — match by city name, location keyword, or warehouse name; output the exact code:",
    warehouseList,
    "",
    "Available roles — output the exact code:",
    roleList,
    "",
    "Rules:",
    `- today's date is ${today} — use it for hireDate if unstated.`,
    "- Match the warehouse by city, location, or name keyword; always output its exact code from the list above.",
    "- If role is unspecified, vague, or expressed as 'any' / 'любую' / 'irgendeine' (or similar in any language) — pick the least privileged / most basic entry-level role from the list above.",
    '- If the user says "same access as <name>", set referenceEmployeeId only if a clear identifier is given.',
    "- Input may be in any language; always output JSON in English.",
    "- Output JSON only — no prose.",
  ].join("\n");
}

export async function loadProvisioningContext(): Promise<ProvisioningContext> {
  const [warehouseRows, roleRows] = await Promise.all([
    dbReadonly
      .select({ code: warehouses.code, name: warehouses.name, location: warehouses.location })
      .from(warehouses)
      .orderBy(asc(warehouses.code)),
    dbReadonly
      .select({ code: roles.code, name: roles.name, description: roles.description })
      .from(roles)
      .orderBy(asc(roles.code)),
  ]);
  return { warehouses: warehouseRows, roles: roleRows };
}

export type ProvisioningResolution =
  | { ok: true; payload: ProvisionPayloadT; explanation: string }
  | { ok: false; error: string };

async function resolveIntent(intent: Intent): Promise<ProvisioningResolution> {
  // role
  const [role] = await dbAdmin
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.code, intent.roleCode))
    .limit(1);
  if (!role) {
    return { ok: false, error: `Unknown role code '${intent.roleCode}'` };
  }
  // warehouse — exact code match, then fuzzy fallback by name / location
  let wh = (
    await dbAdmin
      .select({ id: warehouses.id, code: warehouses.code })
      .from(warehouses)
      .where(eq(warehouses.code, intent.warehouseCode))
      .limit(1)
  )[0];

  if (!wh) {
    // Escape ILIKE metacharacters so underscores/percent in warehouse codes
    // match literally rather than acting as wildcards.
    const raw = intent.warehouseCode;
    const escaped = raw.replace(/[%_\\]/g, "\\$&");
    const term = `%${escaped}%`;
    wh = (
      await dbAdmin
        .select({ id: warehouses.id, code: warehouses.code })
        .from(warehouses)
        .where(
          or(
            sql`${warehouses.name} ilike ${term} escape '\\'`,
            sql`${warehouses.location} ilike ${term} escape '\\'`,
          ),
        )
        .orderBy(asc(warehouses.code))
        .limit(1)
    )[0];
  }

  if (!wh) {
    return {
      ok: false,
      error: `Unknown warehouse '${intent.warehouseCode}'`,
    };
  }
  // extra permissions: resolve codes "system.permission" → permission_id
  const extraIds: string[] = [];
  if (intent.extraPermissionCodes?.length) {
    for (const code of intent.extraPermissionCodes) {
      const [systemCode, permCode] = code.split(".");
      const [row] = await dbAdmin
        .select({ id: permissions.id })
        .from(permissions)
        .innerJoin(systems, eq(systems.id, permissions.systemId))
        .where(and(eq(systems.code, systemCode!), eq(permissions.code, permCode!)))
        .limit(1);
      if (!row) {
        return { ok: false, error: `Unknown permission '${code}'` };
      }
      extraIds.push(row.id);
    }
  }
  // reference user
  let referenceWarehouseUserId: string | undefined;
  if (intent.referenceEmployeeId) {
    const [ref] = await dbAdmin
      .select({ id: warehouseUsers.id })
      .from(warehouseUsers)
      .where(eq(warehouseUsers.employeeId, intent.referenceEmployeeId))
      .limit(1);
    if (!ref) {
      return {
        ok: false,
        error: `Reference user '${intent.referenceEmployeeId}' not found`,
      };
    }
    referenceWarehouseUserId = ref.id;

    // Pull the reference user's currently-active permission IDs and merge
    // into extraPermissionIds.
    const refAccess = await dbAdmin
      .select({ permissionId: userAccess.permissionId })
      .from(userAccess)
      .where(
        and(
          eq(userAccess.warehouseUserId, ref.id),
          eq(userAccess.status, "active"),
        ),
      );
    for (const r of refAccess) {
      if (!extraIds.includes(r.permissionId)) extraIds.push(r.permissionId);
    }
  }

  // Uniqueness check on employeeId
  const [existing] = await dbAdmin
    .select({ id: warehouseUsers.id })
    .from(warehouseUsers)
    .where(eq(warehouseUsers.employeeId, intent.employeeId))
    .limit(1);
  if (existing) {
    return {
      ok: false,
      error: `An employee with id '${intent.employeeId}' already exists`,
    };
  }

  const payload: ProvisionPayloadT = ProvisionPayload.parse({
    employeeId: intent.employeeId,
    fullName: intent.fullName,
    email: intent.email ?? null,
    warehouseId: wh.id,
    roleId: role.id,
    hireDate: intent.hireDate,
    extraPermissionIds: extraIds.length > 0 ? extraIds : undefined,
    referenceWarehouseUserId,
  });

  const explanation = [
    `Provision new warehouse user '${intent.fullName}' (${intent.employeeId})`,
    `at warehouse ${wh.code}`,
    `with role ${intent.roleCode}`,
    referenceWarehouseUserId
      ? `inheriting active permissions from ${intent.referenceEmployeeId}.`
      : `using role-template permissions.`,
    extraIds.length > 0
      ? `Additional permissions resolved: ${extraIds.length}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return { ok: true, payload, explanation };
}

export async function parseProvisioningIntent(text: string): Promise<Intent> {
  const ctx = await loadProvisioningContext();
  const llm = getLLM();
  return await llm.completeJSON(
    [
      { role: "system", content: buildSystemPrompt(ctx) },
      {
        role: "user",
        content:
          "Convert this request to JSON (schema described above):\n\n" + text,
      },
    ],
    IntentSchema,
    { temperature: 0 },
  );
}

export async function proposeProvision(
  text: string,
): Promise<
  | { ok: true; proposalId: string }
  | { ok: false; error: string; parsed?: Intent }
> {
  let intent: Intent;
  try {
    intent = await parseProvisioningIntent(text);
  } catch (err) {
    return {
      ok: false,
      error: `Could not parse request: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const resolved = await resolveIntent(intent);
  if (!resolved.ok) return { ok: false, error: resolved.error, parsed: intent };

  const proposal = await createProposal(dbAdmin, {
    type: "provision",
    targetEntityType: "warehouse_user",
    targetEntityId: null,
    payload: resolved.payload,
    explanation: resolved.explanation,
  });
  return { ok: true, proposalId: proposal.id };
}
