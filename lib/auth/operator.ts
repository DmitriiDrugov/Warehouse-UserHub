/**
 * Operator context for Server Components and Server Actions.
 *
 *   getCurrentOperator()  → operator | null   (no throw, for layouts/nav)
 *   requireOperator()     → operator           (throws/redirects if missing)
 *
 * Looks up the Supabase auth user in `app_users` by `auth_user_id`,
 * validates `is_active = true`, and (for `requireOperator`) enforces
 * the allowed operator_role list.
 *
 * The lookup uses `dbAdmin` (RLS bypass) because the lookup *is* the
 * thing that establishes the operator's identity; we can't RLS-scope a
 * query that needs to find out who we are. Everything *after* this
 * helper runs inside withOperator(operator.id, ...) and respects RLS.
 */

import "server-only";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { dbAdmin } from "../db/client";
import { appUsers, type AppUser } from "../db/schema";
import { type OperatorRole } from "../validation/enums";
import { getSupabaseServerClient } from "./supabase-server";

export type Operator = AppUser;

export class AuthorizationError extends Error {
  readonly status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = "AuthorizationError";
    this.status = status;
  }
}

async function loadOperatorByAuthId(authUserId: string): Promise<Operator | null> {
  const [row] = await dbAdmin
    .select()
    .from(appUsers)
    .where(eq(appUsers.authUserId, authUserId))
    .limit(1);
  return row ?? null;
}

export async function getCurrentOperator(): Promise<Operator | null> {
  const supabase = await getSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const operator = await loadOperatorByAuthId(user.id);
  if (!operator || !operator.isActive) return null;
  return operator;
}

/**
 * Use at the top of every Server Action and every protected page.
 *
 *   const op = await requireOperator(['hr', 'warehouse_admin']);
 *   await withOperator(op.id, async (tx) => { ... mutate ... });
 */
export async function requireOperator(
  allowedRoles?: readonly OperatorRole[],
): Promise<Operator> {
  const operator = await getCurrentOperator();
  if (!operator) {
    // Inside Server Actions, `redirect()` works the same as in Server
    // Components — it throws a NEXT_REDIRECT error caught by the framework.
    redirect("/login");
  }
  if (allowedRoles && !allowedRoles.includes(operator.operatorRole)) {
    throw new AuthorizationError(
      `Operator role '${operator.operatorRole}' is not authorized; required one of: ${allowedRoles.join(", ")}`,
    );
  }
  return operator;
}

/**
 * Convenience for pages that show different content per role without
 * blocking access entirely.
 */
export function canApproveProposals(operator: Operator): boolean {
  return operator.operatorRole === "warehouse_admin";
}

export function canManageOperators(operator: Operator): boolean {
  return operator.operatorRole === "warehouse_admin";
}

export function canManageWarehouseUsers(operator: Operator): boolean {
  return (
    operator.operatorRole === "hr" || operator.operatorRole === "warehouse_admin"
  );
}
