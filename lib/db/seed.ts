/**
 * Idempotent seed script (§9).
 *
 *   pnpm db:seed
 *
 * Creates catalog data and operator accounts only — no warehouse users.
 * Warehouse users should be created via the UI for testing.
 *
 * Reseed is destructive: TRUNCATE all public tables (audit triggers are
 * temporarily disabled), wipe known seeded Supabase auth users, then
 * re-create everything.
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv({ path: ".env" });

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import {
  appUserWarehouses,
  appUsers,
  certificates,
  checklistItems,
  checklistTemplates,
  permissions,
  rolePermissions,
  roles,
  systems,
  warehouses,
  type AppUser,
} from "./schema";
import * as schema from "./schema";

// ---------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------

const SYSTEM_OPERATOR_EMAIL = "system@warehouse-userhub.internal";
const SEED_PASSWORD = process.env.SEED_OPERATOR_PASSWORD ?? "WarehouseDev!2026";

const OPERATORS = [
  {
    email: "admin@example.com",
    fullName: "Test Test",
    operatorRole: "warehouse_admin" as const,
    warehouseCodes: ["WH-A", "WH-B", "WH-C"],
  },
  {
    email: "hr-a@example.com",
    fullName: "Béla Kovács (HR, WH-A)",
    operatorRole: "hr" as const,
    warehouseCodes: ["WH-A"],
  },
  {
    email: "hr-b@example.com",
    fullName: "Clara Dubois (HR, WH-B)",
    operatorRole: "hr" as const,
    warehouseCodes: ["WH-B"],
  },
  {
    email: "hr-c@example.com",
    fullName: "Diego Rossi (HR, WH-C)",
    operatorRole: "hr" as const,
    warehouseCodes: ["WH-C"],
  },
  {
    email: "viewer@example.com",
    fullName: "Eva Novak (Viewer)",
    operatorRole: "viewer" as const,
    warehouseCodes: ["WH-A", "WH-B"],
  },
];

const WAREHOUSES = [
  { code: "WH-A", name: "Berlin Distribution Center", location: "Berlin, DE" },
  { code: "WH-B", name: "Munich Fulfilment", location: "München, DE" },
  { code: "WH-C", name: "Hamburg Port Hub", location: "Hamburg, DE" },
];

const ROLES = [
  {
    code: "forklift_operator",
    name: "Forklift operator",
    description: "Operates counterbalance forklifts on the floor",
  },
  {
    code: "lift_truck_operator",
    name: "Reach-truck / lift operator",
    description: "Operates reach trucks for high-bay racking",
  },
  {
    code: "picker",
    name: "Order picker",
    description: "Picks goods from racks for outbound orders",
  },
  {
    code: "warehouse_supervisor",
    name: "Warehouse supervisor",
    description: "Shift supervisor",
  },
  {
    code: "admin_assistant",
    name: "Administrative assistant",
    description: "Back-office support",
  },
];

const SYSTEMS = [
  { code: "wms", name: "Warehouse Management System" },
  { code: "badge", name: "Physical badge / access control" },
  { code: "email", name: "Corporate email (Microsoft 365)" },
  { code: "shared_account", name: "Shared operational accounts" },
];

const PERMISSIONS = [
  { systemCode: "wms", code: "view_only", name: "View-only WMS access" },
  { systemCode: "wms", code: "receive_inventory", name: "Receive inventory" },
  { systemCode: "wms", code: "dispatch_order", name: "Dispatch outbound orders" },
  {
    systemCode: "wms",
    code: "approve_adjustment",
    name: "Approve inventory adjustments",
  },
  { systemCode: "badge", code: "entry", name: "Floor entry badge" },
  { systemCode: "badge", code: "admin", name: "Badge administration" },
  { systemCode: "email", code: "create_account", name: "Create email account" },
  { systemCode: "email", code: "view_directory", name: "View corporate directory" },
  {
    systemCode: "shared_account",
    code: "warehouse_ops",
    name: "Shared operational login (warehouse-ops@)",
  },
];

const ROLE_TEMPLATES: Record<string, string[]> = {
  forklift_operator: ["wms.dispatch_order", "wms.view_only", "badge.entry"],
  lift_truck_operator: ["wms.dispatch_order", "wms.view_only", "badge.entry"],
  picker: ["wms.view_only", "badge.entry"],
  warehouse_supervisor: [
    "wms.view_only",
    "wms.approve_adjustment",
    "badge.entry",
    "email.view_directory",
  ],
  admin_assistant: [
    "wms.view_only",
    "badge.entry",
    "email.view_directory",
    "email.create_account",
  ],
};

const CERTIFICATES = [
  { code: "forklift", name: "Forklift operator licence", validityDays: 365 },
  { code: "reach_truck", name: "Reach-truck licence", validityDays: 365 },
  { code: "first_aid", name: "First-aid certification", validityDays: 730 },
  { code: "safety_basics", name: "Workplace safety basics", validityDays: 1095 },
];

const CHECKLIST_TEMPLATES = [
  {
    name: "Standard onboarding",
    type: "onboarding" as const,
    roleCode: null,
    items: [
      { label: "Issue physical badge", order: 1, isRequired: true },
      { label: "Provision WMS account", order: 2, isRequired: true },
      { label: "Workplace safety briefing", order: 3, isRequired: true },
      { label: "Sign confidentiality agreement", order: 4, isRequired: true },
      { label: "Tour of warehouse floor", order: 5, isRequired: false },
    ],
  },
  {
    name: "Forklift role onboarding",
    type: "onboarding" as const,
    roleCode: "forklift_operator",
    items: [
      { label: "Verify forklift licence on file", order: 1, isRequired: true },
      { label: "Issue physical badge", order: 2, isRequired: true },
      { label: "Pair WMS handheld device", order: 3, isRequired: true },
      { label: "Shadow shift with senior operator", order: 4, isRequired: true },
    ],
  },
  {
    name: "Standard offboarding",
    type: "offboarding" as const,
    roleCode: null,
    items: [
      { label: "Collect physical badge", order: 1, isRequired: true },
      { label: "Confirm WMS account disabled", order: 2, isRequired: true },
      { label: "Collect company laptop / device", order: 3, isRequired: true },
      { label: "Exit interview", order: 4, isRequired: false },
      { label: "Update HR records", order: 5, isRequired: true },
    ],
  },
];

// ---------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is required");
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !serviceKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required");
  }

  const sqlClient = postgres(dbUrl, { max: 5, prepare: false });
  const db = drizzle(sqlClient, { schema });
  const admin = createClient(supaUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    console.log("[seed] wiping…");
    await wipe(sqlClient);

    console.log("[seed] creating catalogs…");
    const warehousesByCode = await seedCatalogs(db);

    console.log("[seed] creating operators (Supabase auth + app_users)…");
    await seedOperators(db, admin, warehousesByCode);

    console.log("[seed] done.");
    console.log("");
    console.log("Operator credentials (password: " + SEED_PASSWORD + "):");
    for (const op of OPERATORS) {
      console.log(`  ${op.operatorRole.padEnd(16)} ${op.email}`);
    }
    console.log("");
    console.log(
      `System operator (no auth): ${SYSTEM_OPERATOR_EMAIL} — used as audit actor for system-originated rows.`,
    );
    console.log("");
    console.log("Catalog seeded: 3 warehouses, 5 roles, 4 systems, 9 permissions, 4 certificates, 3 checklist templates.");
    console.log("No warehouse users seeded — create them via the UI for testing.");
  } finally {
    await sqlClient.end({ timeout: 5 });
  }
}

// ---------------------------------------------------------------------
// Wipe
// ---------------------------------------------------------------------

async function wipe(client: postgres.Sql): Promise<void> {
  // Audit triggers block UPDATE/DELETE/TRUNCATE for everyone (even superuser).
  // Disable just the audit triggers so we can TRUNCATE during seed.
  await client.unsafe(`
    DO $$ BEGIN
      EXECUTE 'ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_update';
      EXECUTE 'ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_delete';
      EXECUTE 'ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_truncate';
    EXCEPTION WHEN undefined_object THEN NULL;
    END $$;
    TRUNCATE TABLE
      audit_log,
      ai_proposals,
      user_checklist_items,
      user_checklists,
      user_certificates,
      user_access,
      warehouse_users,
      role_permissions,
      permissions,
      systems,
      checklist_items,
      checklist_templates,
      app_user_warehouses,
      app_users,
      certificates,
      roles,
      warehouses
    RESTART IDENTITY CASCADE;
    DO $$ BEGIN
      EXECUTE 'ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_update';
      EXECUTE 'ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_delete';
      EXECUTE 'ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_truncate';
    EXCEPTION WHEN undefined_object THEN NULL;
    END $$;
  `);
}

// ---------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------

async function seedCatalogs(
  db: ReturnType<typeof drizzle<typeof schema>>,
): Promise<Map<string, string>> {
  // warehouses
  const insertedWh = await db.insert(warehouses).values(WAREHOUSES).returning();
  const warehousesByCode = new Map(insertedWh.map((w) => [w.code, w.id]));

  // roles
  const insertedRoles = await db.insert(roles).values(ROLES).returning();
  const rolesByCode = new Map(insertedRoles.map((r) => [r.code, r.id]));

  // systems
  const insertedSystems = await db.insert(systems).values(SYSTEMS).returning();
  const systemsByCode = new Map(insertedSystems.map((s) => [s.code, s.id]));

  // permissions
  const permValues = PERMISSIONS.map((p) => ({
    systemId: systemsByCode.get(p.systemCode)!,
    code: p.code,
    name: p.name,
  }));
  const insertedPerms = await db.insert(permissions).values(permValues).returning();
  const permissionsByCode = new Map<string, string>();
  for (const p of insertedPerms) {
    const sysCode = SYSTEMS.find(
      (s) => systemsByCode.get(s.code) === p.systemId,
    )?.code;
    if (!sysCode) continue;
    permissionsByCode.set(`${sysCode}.${p.code}`, p.id);
  }

  // role_permissions
  const rpValues: Array<{ roleId: string; permissionId: string }> = [];
  for (const [roleCode, permCodes] of Object.entries(ROLE_TEMPLATES)) {
    const roleId = rolesByCode.get(roleCode)!;
    for (const permCode of permCodes) {
      const permId = permissionsByCode.get(permCode);
      if (!permId) throw new Error(`unknown permission code in template: ${permCode}`);
      rpValues.push({ roleId, permissionId: permId });
    }
  }
  if (rpValues.length > 0) {
    await db.insert(rolePermissions).values(rpValues);
  }

  // certificates
  await db.insert(certificates).values(CERTIFICATES);

  // checklist templates + items
  for (const tpl of CHECKLIST_TEMPLATES) {
    const roleId = tpl.roleCode ? rolesByCode.get(tpl.roleCode)! : null;
    const [created] = await db
      .insert(checklistTemplates)
      .values({ name: tpl.name, type: tpl.type, roleId })
      .returning();
    if (!created) throw new Error("template insert returned no row");
    if (tpl.items.length > 0) {
      await db.insert(checklistItems).values(
        tpl.items.map((item) => ({
          templateId: created.id,
          label: item.label,
          order: item.order,
          isRequired: item.isRequired,
        })),
      );
    }
  }

  return warehousesByCode;
}

// ---------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------

type SupabaseAdmin = {
  auth: {
    admin: {
      createUser: (args: {
        email: string;
        password: string;
        email_confirm: boolean;
      }) => Promise<{
        data: { user: { id: string } | null } | null;
        error: { message: string } | null;
      }>;
      listUsers: (args: { page: number; perPage: number }) => Promise<{
        data: { users: Array<{ id: string; email?: string | null }> };
        error: { message: string } | null;
      }>;
      updateUserById: (
        id: string,
        attrs: { password?: string },
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
};

async function ensureSupabaseAuthUser(
  admin: SupabaseAdmin,
  email: string,
): Promise<string> {
  const createRes = await admin.auth.admin.createUser({
    email,
    password: SEED_PASSWORD,
    email_confirm: true,
  });
  if (createRes.data?.user) return createRes.data.user.id;
  const errMsg = createRes.error?.message ?? "";
  if (!/already registered|already exists/i.test(errMsg)) {
    throw new Error(`createUser failed for ${email}: ${errMsg}`);
  }
  // already there — find it and reset password
  let page = 1;
  for (;;) {
    const list = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (list.error) throw new Error(`listUsers failed: ${list.error.message}`);
    const hit = list.data.users.find((u) => u.email === email);
    if (hit) {
      await admin.auth.admin.updateUserById(hit.id, { password: SEED_PASSWORD });
      return hit.id;
    }
    if (list.data.users.length < 200) break;
    page += 1;
  }
  throw new Error(`auth user ${email} not found after createUser conflict`);
}

async function seedOperators(
  db: ReturnType<typeof drizzle<typeof schema>>,
  admin: SupabaseAdmin,
  warehousesByCode: Map<string, string>,
): Promise<Record<string, AppUser>> {
  const out: Record<string, AppUser> = {};

  // System operator: no auth user, used only as audit actor.
  const [systemRow] = await db
    .insert(appUsers)
    .values({
      email: SYSTEM_OPERATOR_EMAIL,
      fullName: "System (rules engine / cron)",
      operatorRole: "warehouse_admin",
      isActive: true,
      authUserId: null,
    })
    .returning();
  if (!systemRow) throw new Error("system operator insert returned no row");
  out[SYSTEM_OPERATOR_EMAIL] = systemRow;

  for (const op of OPERATORS) {
    let authUserId: string | null = null;
    try {
      authUserId = await ensureSupabaseAuthUser(admin, op.email);
    } catch (err) {
      throw new Error(
        `could not create Supabase auth user for ${op.email}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    const [row] = await db
      .insert(appUsers)
      .values({
        email: op.email,
        fullName: op.fullName,
        operatorRole: op.operatorRole,
        isActive: true,
        authUserId,
      })
      .returning();
    if (!row) throw new Error(`operator insert returned no row for ${op.email}`);
    out[op.email] = row;

    if (op.warehouseCodes.length > 0) {
      await db.insert(appUserWarehouses).values(
        op.warehouseCodes.map((code) => ({
          appUserId: row.id,
          warehouseId: warehousesByCode.get(code)!,
        })),
      );
    }
  }
  return out;
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
