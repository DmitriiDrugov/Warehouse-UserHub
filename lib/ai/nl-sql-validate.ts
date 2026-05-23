/**
 * AST-level validator for LLM-generated SQL (§6.1, §8). Refuses anything
 * that is not a single SELECT over the allowed reporting views.
 *
 * What we check:
 *   - parser.astify returns exactly one statement
 *   - statement type === 'select'
 *   - no INTO clause
 *   - no FOR UPDATE / FOR SHARE
 *   - no UNION / INTERSECT / EXCEPT (set ops bypass single-statement intent)
 *   - every FROM/JOIN/subquery table reference is in the view allowlist
 *   - no calls to functions that mutate state or read pg internals
 *   - LIMIT must exist and not exceed NL_SQL_MAX_ROWS — if missing or
 *     larger, we rewrite it to NL_SQL_MAX_ROWS
 *
 * After validation we re-serialize the (possibly LIMIT-rewritten) AST with
 * parser.sqlify so the executed SQL is the parser's canonical form — not
 * the raw LLM string.
 */

import { Parser } from "node-sql-parser";

import { NL_VIEW_NAMES } from "./nl-sql-views";

const parser = new Parser();
const PG_OPT = { database: "PostgresQL" } as const;

const FORBIDDEN_FUNCTIONS = new Set(
  [
    // privilege / role inspection
    "current_user",
    "session_user",
    "current_role",
    "current_database",
    "current_catalog",
    "current_schemas",
    "has_table_privilege",
    "has_schema_privilege",
    "has_database_privilege",
    "has_column_privilege",
    "pg_read_file",
    "pg_read_binary_file",
    "pg_ls_dir",
    "lo_import",
    "lo_export",
    "copy",
    "pg_sleep",
    "pg_terminate_backend",
    "pg_cancel_backend",
    "set_config",
    "current_setting",
  ].map((s) => s.toLowerCase()),
);

export type ValidationError = {
  code:
    | "parse_failed"
    | "not_single_statement"
    | "not_select"
    | "set_operation"
    | "into_clause"
    | "for_clause"
    | "disallowed_table"
    | "disallowed_function"
    | "limit_too_large";
  message: string;
};

export type ValidationResult =
  | { ok: true; sql: string; tablesUsed: string[]; appliedLimit: number }
  | { ok: false; error: ValidationError };

export type ValidateOptions = {
  maxRows: number;
};

type AstLike = Record<string, unknown> & {
  type?: string;
  with?: unknown;
  union?: unknown;
  set_op?: unknown;
  into?: unknown;
  for?: unknown;
  limit?: unknown;
};

export function validateAndCanonicalize(
  rawSql: string,
  options: ValidateOptions,
): ValidationResult {
  // Reject obvious multi-statement payloads BEFORE parsing (defence in
  // depth — the parser is mostly good but a few drivers handle ';' oddly).
  if (/;\s*\S/.test(rawSql.replace(/;\s*$/, ""))) {
    return {
      ok: false,
      error: {
        code: "not_single_statement",
        message: "multiple statements are not allowed",
      },
    };
  }

  let ast: unknown;
  try {
    ast = parser.astify(rawSql, PG_OPT);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "parse_failed",
        message: `SQL parse failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }

  if (Array.isArray(ast)) {
    if (ast.length !== 1) {
      return {
        ok: false,
        error: {
          code: "not_single_statement",
          message: `expected 1 statement, got ${ast.length}`,
        },
      };
    }
    ast = ast[0];
  }
  const stmt = ast as AstLike;

  if (stmt.type !== "select") {
    return {
      ok: false,
      error: {
        code: "not_select",
        message: `only SELECT is allowed (got ${String(stmt.type)})`,
      },
    };
  }
  if (stmt.with) {
    return {
      ok: false,
      error: {
        code: "not_select",
        message: "WITH (CTEs) are not allowed",
      },
    };
  }
  if (stmt.set_op || stmt.union) {
    return {
      ok: false,
      error: {
        code: "set_operation",
        message: "UNION / INTERSECT / EXCEPT are not allowed",
      },
    };
  }
  // node-sql-parser emits `into: { position: null }` for plain SELECTs;
  // only flag real INTO (e.g. `into.position` truthy or `into.expr` set).
  if (stmt.into && typeof stmt.into === "object") {
    const intoNode = stmt.into as { position?: unknown; expr?: unknown };
    if (intoNode.position || intoNode.expr) {
      return {
        ok: false,
        error: { code: "into_clause", message: "SELECT INTO is not allowed" },
      };
    }
  }
  // Same defensive check for FOR UPDATE/SHARE — the parser emits truthy
  // descriptors only when actually present.
  if (stmt.for && typeof stmt.for === "object") {
    const forNode = stmt.for as { type?: unknown; lock_strength?: unknown };
    if (forNode.type || forNode.lock_strength) {
      return {
        ok: false,
        error: { code: "for_clause", message: "FOR UPDATE/SHARE is not allowed" },
      };
    }
  } else if (typeof stmt.for === "string" && stmt.for.length > 0) {
    return {
      ok: false,
      error: { code: "for_clause", message: "FOR UPDATE/SHARE is not allowed" },
    };
  }

  // Collect all table references via parser.tableList (no extra walk needed).
  // tableList returns entries like "select::public::v_user_access".
  let tableList: string[];
  try {
    tableList = parser.tableList(rawSql, PG_OPT);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "parse_failed",
        message: `tableList failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
  const tablesUsed: string[] = [];
  for (const entry of tableList) {
    const parts = entry.split("::");
    const op = parts[0];
    const tbl = parts[parts.length - 1];
    if (op !== "select") {
      return {
        ok: false,
        error: {
          code: "not_select",
          message: `non-select operation detected: ${op}`,
        },
      };
    }
    if (!tbl || !NL_VIEW_NAMES.has(tbl)) {
      return {
        ok: false,
        error: {
          code: "disallowed_table",
          message: `'${tbl}' is not one of the allowed reporting views`,
        },
      };
    }
    tablesUsed.push(tbl);
  }

  // Function check via parser.columnList — entries are "select::null::expr"
  // for function calls. We instead walk the AST for `function` nodes.
  const fnError = checkForbiddenFunctions(stmt);
  if (fnError) {
    return { ok: false, error: fnError };
  }

  // Enforce LIMIT.
  const appliedLimit = enforceLimit(stmt, options.maxRows);

  let canonical: string;
  try {
    canonical = parser.sqlify(stmt as never, PG_OPT);
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "parse_failed",
        message: `sqlify failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
  return {
    ok: true,
    sql: canonical,
    tablesUsed,
    appliedLimit,
  };
}

function checkForbiddenFunctions(stmt: AstLike): ValidationError | null {
  let found: string | null = null;
  visit(stmt, (node) => {
    if (found) return;
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; name?: unknown };
    if (n.type === "function" || n.type === "aggr_func") {
      const name = extractFunctionName(n.name);
      if (name && FORBIDDEN_FUNCTIONS.has(name.toLowerCase())) {
        found = name;
      }
    }
  });
  if (found !== null) {
    return {
      code: "disallowed_function",
      message: `function '${found}' is not allowed in NL queries`,
    };
  }
  return null;
}

function extractFunctionName(name: unknown): string | null {
  if (typeof name === "string") return name;
  if (Array.isArray(name)) {
    const last = name[name.length - 1] as { value?: string; name?: string } | undefined;
    if (!last) return null;
    return last.value ?? last.name ?? null;
  }
  if (name && typeof name === "object") {
    const n = name as { name?: unknown; value?: string };
    if (typeof n.value === "string") return n.value;
    if (n.name) return extractFunctionName(n.name);
  }
  return null;
}

function visit(node: unknown, fn: (n: unknown) => void): void {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    for (const item of node) visit(item, fn);
    return;
  }
  if (typeof node !== "object") return;
  fn(node);
  for (const v of Object.values(node)) visit(v, fn);
}

function enforceLimit(stmt: AstLike, maxRows: number): number {
  const newLimit = {
    seperator: "",
    value: [{ type: "number", value: maxRows }],
  };
  const current = stmt.limit;
  if (current && typeof current === "object" && Array.isArray((current as { value?: unknown }).value)) {
    const vals = (current as { value: Array<{ type: string; value: number }> }).value;
    // value is either [N] for `LIMIT N` or [offset, N] for `LIMIT N OFFSET …`.
    const limitEntry = vals[vals.length - 1];
    const requested =
      limitEntry && typeof limitEntry.value === "number"
        ? limitEntry.value
        : Number.POSITIVE_INFINITY;
    if (requested <= maxRows && requested > 0) return requested;
  }
  stmt.limit = newLimit;
  return maxRows;
}
