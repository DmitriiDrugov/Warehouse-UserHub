/**
 * Drizzle schema for Warehouse UserHub (§3).
 *
 * - Two distinct entity kinds:
 *     operators (`appUsers`) — log in, have operator_role.
 *     warehouse users (`warehouseUsers`) — managed records, not logins.
 *   Never conflate them.
 *
 * - `userAccess` is the single source of truth for actually-granted rights.
 *   Only the deterministic services layer writes to it. AI never touches it.
 *
 * - `auditLog` is append-only — the immutability trigger lives in the
 *   companion SQL migration (`0001_security_extras.sql`).
 *
 * - All authorization tables get RLS enabled and policies in `0001_security_extras.sql`.
 */

import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  ACCESS_SOURCES,
  ACCESS_STATUSES,
  CERTIFICATE_STATUSES,
  CHECKLIST_STATUSES,
  CHECKLIST_TYPES,
  OPERATOR_ROLES,
  PROPOSAL_CREATORS,
  PROPOSAL_STATUSES,
  PROPOSAL_TYPES,
  WAREHOUSE_USER_STATUSES,
} from "../validation/enums";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const operatorRoleEnum = pgEnum("operator_role", OPERATOR_ROLES);
export const warehouseUserStatusEnum = pgEnum(
  "warehouse_user_status",
  WAREHOUSE_USER_STATUSES,
);
export const accessSourceEnum = pgEnum("access_source", ACCESS_SOURCES);
export const accessStatusEnum = pgEnum("access_status", ACCESS_STATUSES);
export const certificateStatusEnum = pgEnum(
  "certificate_status",
  CERTIFICATE_STATUSES,
);
export const checklistTypeEnum = pgEnum("checklist_type", CHECKLIST_TYPES);
export const checklistStatusEnum = pgEnum(
  "checklist_status",
  CHECKLIST_STATUSES,
);
export const proposalTypeEnum = pgEnum("proposal_type", PROPOSAL_TYPES);
export const proposalStatusEnum = pgEnum("proposal_status", PROPOSAL_STATUSES);
export const proposalCreatorEnum = pgEnum(
  "proposal_creator",
  PROPOSAL_CREATORS,
);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .default(sql`now()`),
};

// ---------------------------------------------------------------------------
// Operators & tenancy
// ---------------------------------------------------------------------------

export const warehouses = pgTable(
  "warehouses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    location: text("location"),
    ...timestamps,
  },
  (t) => ({
    codeUnique: uniqueIndex("warehouses_code_unique").on(t.code),
  }),
);

export const appUsers = pgTable(
  "app_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Supabase auth.users.id. Nullable so we can seed operators before linking
    // them to a real Supabase auth account in dev.
    authUserId: uuid("auth_user_id"),
    email: text("email").notNull(),
    fullName: text("full_name").notNull(),
    operatorRole: operatorRoleEnum("operator_role").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => ({
    emailUnique: uniqueIndex("app_users_email_unique").on(t.email),
    authUserIdUnique: uniqueIndex("app_users_auth_user_id_unique").on(
      t.authUserId,
    ),
  }),
);

export const appUserWarehouses = pgTable(
  "app_user_warehouses",
  {
    appUserId: uuid("app_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.appUserId, t.warehouseId] }),
    byWarehouse: index("app_user_warehouses_by_warehouse").on(t.warehouseId),
  }),
);

// ---------------------------------------------------------------------------
// Catalogs: roles, systems, permissions, role templates
// ---------------------------------------------------------------------------

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    ...timestamps,
  },
  (t) => ({
    codeUnique: uniqueIndex("roles_code_unique").on(t.code),
  }),
);

export const systems = pgTable(
  "systems",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    ...timestamps,
  },
  (t) => ({
    codeUnique: uniqueIndex("systems_code_unique").on(t.code),
  }),
);

export const permissions = pgTable(
  "permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    systemId: uuid("system_id")
      .notNull()
      .references(() => systems.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    ...timestamps,
  },
  (t) => ({
    systemCodeUnique: uniqueIndex("permissions_system_code_unique").on(
      t.systemId,
      t.code,
    ),
    bySystem: index("permissions_by_system").on(t.systemId),
  }),
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roleId, t.permissionId] }),
    byPermission: index("role_permissions_by_permission").on(t.permissionId),
  }),
);

// ---------------------------------------------------------------------------
// Managed workforce
// ---------------------------------------------------------------------------

export const warehouseUsers = pgTable(
  "warehouse_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: text("employee_id").notNull(),
    fullName: text("full_name").notNull(),
    email: text("email"),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id, { onDelete: "restrict" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    status: warehouseUserStatusEnum("status").notNull().default("pending"),
    hireDate: date("hire_date", { mode: "date" }).notNull(),
    terminationDate: date("termination_date", { mode: "date" }),
    ...timestamps,
  },
  (t) => ({
    employeeIdUnique: uniqueIndex("warehouse_users_employee_id_unique").on(
      t.employeeId,
    ),
    byWarehouse: index("warehouse_users_by_warehouse").on(t.warehouseId),
    byStatus: index("warehouse_users_by_status").on(t.status),
    byRole: index("warehouse_users_by_role").on(t.roleId),
  }),
);

export const userAccess = pgTable(
  "user_access",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    warehouseUserId: uuid("warehouse_user_id")
      .notNull()
      .references(() => warehouseUsers.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id")
      .notNull()
      .references(() => permissions.id, { onDelete: "restrict" }),
    grantedBy: uuid("granted_by")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    grantedAt: timestamp("granted_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    source: accessSourceEnum("source").notNull(),
    status: accessStatusEnum("status").notNull().default("active"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (t) => ({
    byWarehouseUser: index("user_access_by_warehouse_user").on(
      t.warehouseUserId,
    ),
    byPermission: index("user_access_by_permission").on(t.permissionId),
    byStatus: index("user_access_by_status").on(t.status),
    byExpiresAt: index("user_access_by_expires_at").on(t.expiresAt),
    byLastUsedAt: index("user_access_by_last_used_at").on(t.lastUsedAt),
    byStatusExpires: index("user_access_by_status_expires").on(
      t.status,
      t.expiresAt,
    ),
    // Guard against duplicate active grants of the same permission to the same
    // user. Revoked/expired rows are kept for history; a unique partial index
    // on (warehouse_user_id, permission_id) WHERE status='active' is added in
    // the security_extras migration (drizzle-kit doesn't support partial
    // indexes natively in 0.28).
  }),
);

// ---------------------------------------------------------------------------
// Training & compliance
// ---------------------------------------------------------------------------

export const certificates = pgTable(
  "certificates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    validityDays: integer("validity_days"),
    ...timestamps,
  },
  (t) => ({
    codeUnique: uniqueIndex("certificates_code_unique").on(t.code),
  }),
);

export const userCertificates = pgTable(
  "user_certificates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    warehouseUserId: uuid("warehouse_user_id")
      .notNull()
      .references(() => warehouseUsers.id, { onDelete: "cascade" }),
    certificateId: uuid("certificate_id")
      .notNull()
      .references(() => certificates.id, { onDelete: "restrict" }),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    status: certificateStatusEnum("status").notNull().default("valid"),
    documentPath: text("document_path"),
    ...timestamps,
  },
  (t) => ({
    byWarehouseUser: index("user_certificates_by_warehouse_user").on(
      t.warehouseUserId,
    ),
    byCertificate: index("user_certificates_by_certificate").on(
      t.certificateId,
    ),
    byExpiresAt: index("user_certificates_by_expires_at").on(t.expiresAt),
    byStatus: index("user_certificates_by_status").on(t.status),
  }),
);

// ---------------------------------------------------------------------------
// Onboarding / offboarding checklists
// ---------------------------------------------------------------------------

export const checklistTemplates = pgTable(
  "checklist_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    type: checklistTypeEnum("type").notNull(),
    roleId: uuid("role_id").references(() => roles.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => ({
    byTypeRole: index("checklist_templates_by_type_role").on(t.type, t.roleId),
  }),
);

export const checklistItems = pgTable(
  "checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => checklistTemplates.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    order: integer("order").notNull(),
    isRequired: boolean("is_required").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    byTemplate: index("checklist_items_by_template").on(t.templateId, t.order),
  }),
);

export const userChecklists = pgTable(
  "user_checklists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    warehouseUserId: uuid("warehouse_user_id")
      .notNull()
      .references(() => warehouseUsers.id, { onDelete: "cascade" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => checklistTemplates.id, { onDelete: "restrict" }),
    type: checklistTypeEnum("type").notNull(),
    status: checklistStatusEnum("status").notNull().default("in_progress"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    byWarehouseUser: index("user_checklists_by_warehouse_user").on(
      t.warehouseUserId,
    ),
    byStatus: index("user_checklists_by_status").on(t.status),
  }),
);

export const userChecklistItems = pgTable(
  "user_checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userChecklistId: uuid("user_checklist_id")
      .notNull()
      .references(() => userChecklists.id, { onDelete: "cascade" }),
    checklistItemId: uuid("checklist_item_id")
      .notNull()
      .references(() => checklistItems.id, { onDelete: "restrict" }),
    isDone: boolean("is_done").notNull().default(false),
    doneBy: uuid("done_by").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    byUserChecklist: index("user_checklist_items_by_user_checklist").on(
      t.userChecklistId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// AI proposals queue
// ---------------------------------------------------------------------------

export const aiProposals = pgTable(
  "ai_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: proposalTypeEnum("type").notNull(),
    targetEntityType: text("target_entity_type").notNull(),
    targetEntityId: uuid("target_entity_id"),
    payload: jsonb("payload").notNull(),
    explanation: text("explanation").notNull(),
    generatedQuery: text("generated_query"),
    status: proposalStatusEnum("status").notNull().default("pending"),
    createdBy: proposalCreatorEnum("created_by").notNull().default("system"),
    reviewedBy: uuid("reviewed_by").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    ...timestamps,
  },
  (t) => ({
    byStatus: index("ai_proposals_by_status").on(t.status),
    byType: index("ai_proposals_by_type").on(t.type),
    byTarget: index("ai_proposals_by_target").on(
      t.targetEntityType,
      t.targetEntityId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Worker documents
// ---------------------------------------------------------------------------

export const workerDocuments = pgTable(
  "worker_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // null until the proposal is approved and the worker is created
    workerId: uuid("worker_id").references(() => warehouseUsers.id, {
      onDelete: "cascade",
    }),
    // set when uploaded via AI chat; cleared on worker link
    proposalId: uuid("proposal_id").references(() => aiProposals.id, {
      onDelete: "set null",
    }),
    documentType: text("document_type").notNull(),
    fileName: text("file_name").notNull(),
    // Supabase Storage object path, e.g. "proposals/abc/contract/file.pdf"
    storagePath: text("storage_path").notNull(),
    fileSizeBytes: integer("file_size_bytes"),
    mimeType: text("mime_type"),
    uploadedBy: uuid("uploaded_by").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    byWorker: index("worker_documents_by_worker").on(t.workerId),
    byProposal: index("worker_documents_by_proposal").on(t.proposalId),
  }),
);

// ---------------------------------------------------------------------------
// AI chat history
// ---------------------------------------------------------------------------

export const aiChatMessages = pgTable(
  "ai_chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    operatorId: uuid("operator_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content"),
    result: jsonb("result"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    byOperatorCreatedAt: index("ai_chat_messages_by_operator_created_at").on(
      t.operatorId,
      t.createdAt,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Append-only audit log
// ---------------------------------------------------------------------------

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    aiAssisted: boolean("ai_assisted").notNull().default(false),
    // RESTRICT (not SET NULL): SET NULL would require an UPDATE on the
    // audit row, which the append-only trigger correctly rejects. Better
    // semantically too — losing the proposal linkage would degrade the
    // audit trail.
    proposalId: uuid("proposal_id").references(() => aiProposals.id, {
      onDelete: "restrict",
    }),
    before: jsonb("before"),
    after: jsonb("after"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .default(sql`now()`),
  },
  (t) => ({
    byEntity: index("audit_log_by_entity").on(t.entityType, t.entityId),
    byActor: index("audit_log_by_actor").on(t.actorId),
    byProposal: index("audit_log_by_proposal").on(t.proposalId),
    byCreatedAt: index("audit_log_by_created_at").on(t.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// Relations (for typed query joins)
// ---------------------------------------------------------------------------

export const warehousesRelations = relations(warehouses, ({ many }) => ({
  warehouseUsers: many(warehouseUsers),
  operators: many(appUserWarehouses),
}));

export const appUsersRelations = relations(appUsers, ({ many }) => ({
  warehouses: many(appUserWarehouses),
  grantedAccess: many(userAccess, { relationName: "grantedAccess" }),
  revokedAccess: many(userAccess, { relationName: "revokedAccess" }),
  auditEntries: many(auditLog),
  reviewedProposals: many(aiProposals),
  aiChatMessages: many(aiChatMessages),
}));

export const appUserWarehousesRelations = relations(
  appUserWarehouses,
  ({ one }) => ({
    appUser: one(appUsers, {
      fields: [appUserWarehouses.appUserId],
      references: [appUsers.id],
    }),
    warehouse: one(warehouses, {
      fields: [appUserWarehouses.warehouseId],
      references: [warehouses.id],
    }),
  }),
);

export const rolesRelations = relations(roles, ({ many }) => ({
  warehouseUsers: many(warehouseUsers),
  rolePermissions: many(rolePermissions),
  checklistTemplates: many(checklistTemplates),
}));

export const systemsRelations = relations(systems, ({ many }) => ({
  permissions: many(permissions),
}));

export const permissionsRelations = relations(permissions, ({ one, many }) => ({
  system: one(systems, {
    fields: [permissions.systemId],
    references: [systems.id],
  }),
  rolePermissions: many(rolePermissions),
  userAccess: many(userAccess),
}));

export const rolePermissionsRelations = relations(
  rolePermissions,
  ({ one }) => ({
    role: one(roles, {
      fields: [rolePermissions.roleId],
      references: [roles.id],
    }),
    permission: one(permissions, {
      fields: [rolePermissions.permissionId],
      references: [permissions.id],
    }),
  }),
);

export const warehouseUsersRelations = relations(
  warehouseUsers,
  ({ one, many }) => ({
    warehouse: one(warehouses, {
      fields: [warehouseUsers.warehouseId],
      references: [warehouses.id],
    }),
    role: one(roles, {
      fields: [warehouseUsers.roleId],
      references: [roles.id],
    }),
    access: many(userAccess),
    certificates: many(userCertificates),
    checklists: many(userChecklists),
    documents: many(workerDocuments),
  }),
);

export const userAccessRelations = relations(userAccess, ({ one }) => ({
  warehouseUser: one(warehouseUsers, {
    fields: [userAccess.warehouseUserId],
    references: [warehouseUsers.id],
  }),
  permission: one(permissions, {
    fields: [userAccess.permissionId],
    references: [permissions.id],
  }),
  grantedByOperator: one(appUsers, {
    fields: [userAccess.grantedBy],
    references: [appUsers.id],
    relationName: "grantedAccess",
  }),
  revokedByOperator: one(appUsers, {
    fields: [userAccess.revokedBy],
    references: [appUsers.id],
    relationName: "revokedAccess",
  }),
}));

export const certificatesRelations = relations(certificates, ({ many }) => ({
  userCertificates: many(userCertificates),
}));

export const userCertificatesRelations = relations(
  userCertificates,
  ({ one }) => ({
    warehouseUser: one(warehouseUsers, {
      fields: [userCertificates.warehouseUserId],
      references: [warehouseUsers.id],
    }),
    certificate: one(certificates, {
      fields: [userCertificates.certificateId],
      references: [certificates.id],
    }),
  }),
);

export const workerDocumentsRelations = relations(
  workerDocuments,
  ({ one }) => ({
    worker: one(warehouseUsers, {
      fields: [workerDocuments.workerId],
      references: [warehouseUsers.id],
    }),
    proposal: one(aiProposals, {
      fields: [workerDocuments.proposalId],
      references: [aiProposals.id],
    }),
  }),
);

export const aiChatMessagesRelations = relations(aiChatMessages, ({ one }) => ({
  operator: one(appUsers, {
    fields: [aiChatMessages.operatorId],
    references: [appUsers.id],
  }),
}));

export const checklistTemplatesRelations = relations(
  checklistTemplates,
  ({ one, many }) => ({
    role: one(roles, {
      fields: [checklistTemplates.roleId],
      references: [roles.id],
    }),
    items: many(checklistItems),
    instances: many(userChecklists),
  }),
);

export const checklistItemsRelations = relations(checklistItems, ({ one }) => ({
  template: one(checklistTemplates, {
    fields: [checklistItems.templateId],
    references: [checklistTemplates.id],
  }),
}));

export const userChecklistsRelations = relations(
  userChecklists,
  ({ one, many }) => ({
    warehouseUser: one(warehouseUsers, {
      fields: [userChecklists.warehouseUserId],
      references: [warehouseUsers.id],
    }),
    template: one(checklistTemplates, {
      fields: [userChecklists.templateId],
      references: [checklistTemplates.id],
    }),
    items: many(userChecklistItems),
  }),
);

export const userChecklistItemsRelations = relations(
  userChecklistItems,
  ({ one }) => ({
    userChecklist: one(userChecklists, {
      fields: [userChecklistItems.userChecklistId],
      references: [userChecklists.id],
    }),
    item: one(checklistItems, {
      fields: [userChecklistItems.checklistItemId],
      references: [checklistItems.id],
    }),
    doneByOperator: one(appUsers, {
      fields: [userChecklistItems.doneBy],
      references: [appUsers.id],
    }),
  }),
);

export const aiProposalsRelations = relations(aiProposals, ({ one, many }) => ({
  reviewer: one(appUsers, {
    fields: [aiProposals.reviewedBy],
    references: [appUsers.id],
  }),
  auditEntries: many(auditLog),
  stagedDocuments: many(workerDocuments),
}));

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  actor: one(appUsers, {
    fields: [auditLog.actorId],
    references: [appUsers.id],
  }),
  proposal: one(aiProposals, {
    fields: [auditLog.proposalId],
    references: [aiProposals.id],
  }),
}));

// ---------------------------------------------------------------------------
// Inferred types for use in services / validation
// ---------------------------------------------------------------------------

export type AppUser = typeof appUsers.$inferSelect;
export type NewAppUser = typeof appUsers.$inferInsert;
export type Warehouse = typeof warehouses.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type System = typeof systems.$inferSelect;
export type Permission = typeof permissions.$inferSelect;
export type WarehouseUser = typeof warehouseUsers.$inferSelect;
export type NewWarehouseUser = typeof warehouseUsers.$inferInsert;
export type UserAccess = typeof userAccess.$inferSelect;
export type NewUserAccess = typeof userAccess.$inferInsert;
export type Certificate = typeof certificates.$inferSelect;
export type UserCertificate = typeof userCertificates.$inferSelect;
export type NewUserCertificate = typeof userCertificates.$inferInsert;
export type ChecklistTemplate = typeof checklistTemplates.$inferSelect;
export type ChecklistItem = typeof checklistItems.$inferSelect;
export type UserChecklist = typeof userChecklists.$inferSelect;
export type UserChecklistItem = typeof userChecklistItems.$inferSelect;
export type AiProposal = typeof aiProposals.$inferSelect;
export type NewAiProposal = typeof aiProposals.$inferInsert;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
export type WorkerDocument = typeof workerDocuments.$inferSelect;
export type NewWorkerDocument = typeof workerDocuments.$inferInsert;
export type AiChatMessage = typeof aiChatMessages.$inferSelect;
export type NewAiChatMessage = typeof aiChatMessages.$inferInsert;
