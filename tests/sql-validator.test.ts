/**
 * SQL AST validator tests (§11). Asserts that:
 *   - mutations (INSERT/UPDATE/DELETE/etc) are rejected
 *   - multi-statement payloads are rejected
 *   - non-allowlisted views are rejected
 *   - CTEs / set operations / SELECT INTO / FOR UPDATE are rejected
 *   - calls to forbidden functions are rejected
 *   - missing LIMIT is replaced with the configured max
 *   - oversize LIMIT is clamped to the configured max
 *   - well-formed SELECTs over allowed views pass through with the
 *     canonical SQL returned by the validator
 */

import { describe, expect, it } from "vitest";

import { validateAndCanonicalize } from "@/lib/ai/nl-sql-validate";

const OPTIONS = { maxRows: 100 };

function assertOk(
  res: ReturnType<typeof validateAndCanonicalize>,
): asserts res is Extract<ReturnType<typeof validateAndCanonicalize>, { ok: true }> {
  if (!res.ok) {
    throw new Error(`expected ok, got: ${res.error.code} ${res.error.message}`);
  }
}

describe("validateAndCanonicalize", () => {
  it("accepts a SELECT over an allowlisted view", () => {
    const res = validateAndCanonicalize(
      "SELECT employee_id, full_name FROM v_warehouse_users WHERE status = 'active' LIMIT 50",
      OPTIONS,
    );
    assertOk(res);
    expect(res.tablesUsed).toEqual(["v_warehouse_users"]);
    expect(res.appliedLimit).toBe(50);
    expect(res.sql.toLowerCase()).toContain("v_warehouse_users");
  });

  it("rejects INSERT", () => {
    const res = validateAndCanonicalize(
      "INSERT INTO v_warehouse_users (employee_id) VALUES ('foo')",
      OPTIONS,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(["not_select", "parse_failed"]).toContain(res.error.code);
  });

  it("rejects DELETE", () => {
    const res = validateAndCanonicalize(
      "DELETE FROM v_warehouse_users WHERE 1=1",
      OPTIONS,
    );
    expect(res.ok).toBe(false);
  });

  it("rejects UPDATE", () => {
    const res = validateAndCanonicalize(
      "UPDATE v_warehouse_users SET full_name='x'",
      OPTIONS,
    );
    expect(res.ok).toBe(false);
  });

  it("rejects multi-statement payloads", () => {
    const res = validateAndCanonicalize(
      "SELECT 1 FROM v_warehouse_users LIMIT 1; DROP TABLE app_users",
      OPTIONS,
    );
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(["not_single_statement", "parse_failed"]).toContain(res.error.code);
  });

  it("rejects references to non-allowlisted views/tables", () => {
    const res = validateAndCanonicalize(
      "SELECT * FROM app_users LIMIT 1",
      OPTIONS,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("disallowed_table");
  });

  it("rejects WITH (CTEs)", () => {
    const res = validateAndCanonicalize(
      "WITH x AS (SELECT 1) SELECT * FROM v_warehouse_users LIMIT 1",
      OPTIONS,
    );
    expect(res.ok).toBe(false);
  });

  it("rejects UNION", () => {
    const res = validateAndCanonicalize(
      "SELECT employee_id FROM v_warehouse_users UNION SELECT employee_id FROM v_user_access",
      OPTIONS,
    );
    expect(res.ok).toBe(false);
    if (!res.ok)
      expect(["set_operation", "parse_failed"]).toContain(res.error.code);
  });

  it("rejects calls to forbidden functions", () => {
    const res = validateAndCanonicalize(
      "SELECT pg_sleep(1) FROM v_warehouse_users LIMIT 1",
      OPTIONS,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("disallowed_function");
  });

  it("injects LIMIT when missing", () => {
    const res = validateAndCanonicalize(
      "SELECT employee_id FROM v_warehouse_users",
      OPTIONS,
    );
    assertOk(res);
    expect(res.appliedLimit).toBe(100);
    expect(res.sql.toLowerCase()).toContain("limit 100");
  });

  it("clamps oversized LIMIT to the configured max", () => {
    const res = validateAndCanonicalize(
      "SELECT employee_id FROM v_warehouse_users LIMIT 9999",
      OPTIONS,
    );
    assertOk(res);
    expect(res.appliedLimit).toBe(100);
  });

  it("leaves an in-range LIMIT untouched", () => {
    const res = validateAndCanonicalize(
      "SELECT employee_id FROM v_warehouse_users LIMIT 25",
      OPTIONS,
    );
    assertOk(res);
    expect(res.appliedLimit).toBe(25);
  });

  it("accepts a multi-view JOIN over allowlisted views", () => {
    const res = validateAndCanonicalize(
      `SELECT a.employee_id FROM v_user_access a
        JOIN v_user_certificates c ON c.warehouse_user_id = a.warehouse_user_id
        WHERE a.status = 'active' AND c.status <> 'valid'`,
      OPTIONS,
    );
    assertOk(res);
    expect(res.tablesUsed.sort()).toEqual(["v_user_access", "v_user_certificates"]);
  });
});
