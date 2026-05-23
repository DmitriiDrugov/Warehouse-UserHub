# Flexible NL Provisioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make natural-language worker provisioning accept free-form input in any language — city names instead of warehouse codes, vague role descriptions instead of exact codes.

**Architecture:** Load available warehouses and roles from the DB before each LLM call and inject them into the system prompt. The LLM fuzzy-matches user input against this live context and returns valid codes. A secondary fuzzy-fallback ILIKE query in `resolveIntent` acts as a safety net if the LLM still returns a non-code string.

**Tech Stack:** Drizzle ORM (`ilike`, `or`), Claude LLM via `getLLM()`, Zod, Vitest.

---

## File Map

| File | Action | What changes |
|------|--------|-------------|
| `lib/ai/provisioning.ts` | Modify | Add `ProvisioningContext` type, `loadProvisioningContext()`, update `buildSystemPrompt` signature + body, update `parseProvisioningIntent`, add fuzzy fallback in `resolveIntent` |
| `tests/nl-provisioning.test.ts` | Create | Unit tests for `buildSystemPrompt` |

---

### Task 1: TDD — `buildSystemPrompt(ctx)` with live warehouse/role context

**Files:**
- Modify: `lib/ai/provisioning.ts`
- Create: `tests/nl-provisioning.test.ts`

- [ ] **Step 1: Add `ProvisioningContext` type and export `buildSystemPrompt`**

In `lib/ai/provisioning.ts`, add the type after the existing imports and change the function signature. The body stays empty-context-aware for now (we add `ctx` parameter but keep the old logic so the file still compiles):

```ts
// Add after imports, before IntentSchema:
export type ProvisioningContext = {
  warehouses: { code: string; name: string; location: string | null }[];
  roles: { code: string; name: string; description: string | null }[];
};
```

Change `buildSystemPrompt()` to `export function buildSystemPrompt(ctx: ProvisioningContext): string` — keep the old body for now (just add the parameter and `_ctx` or use `ctx` as a placeholder so TS is happy):

```ts
export function buildSystemPrompt(ctx: ProvisioningContext): string {
  const today = new Date().toISOString().slice(0, 10);
  void ctx; // placeholder — replaced in Step 5
  return [
    "You convert a single English provisioning request into a JSON object.",
    "Schema:",
    '{ employeeId: string, fullName: string, email?: string, warehouseCode: string, roleCode: string, hireDate: ISO date string, referenceEmployeeId?: string, extraPermissionCodes?: string[] ("system_code.permission_code") }',
    `Rules: pick the simplest interpretation; today's date is ${today} — use it for hireDate if unstated; if the user says "same access as <name>" set referenceEmployeeId only if a clear identifier is given. Output JSON only — no prose.`,
  ].join("\n");
}
```

- [ ] **Step 2: Write failing tests**

Create `tests/nl-provisioning.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSystemPrompt, type ProvisioningContext } from "@/lib/ai/provisioning";

const ctx: ProvisioningContext = {
  warehouses: [
    { code: "WH-X", name: "Berlin Distribution Center", location: "Berlin, DE" },
    { code: "WH-Y", name: "Munich Fulfilment", location: "München, DE" },
  ],
  roles: [
    { code: "picker", name: "Order picker", description: "Picks goods from racks" },
    { code: "warehouse_supervisor", name: "Warehouse supervisor", description: "Shift supervisor" },
  ],
};

describe("buildSystemPrompt", () => {
  it("includes warehouse codes in the output", () => {
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("WH-X");
    expect(prompt).toContain("WH-Y");
  });

  it("includes warehouse names and locations", () => {
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("Berlin Distribution Center");
    expect(prompt).toContain("München, DE");
  });

  it("includes role codes in the output", () => {
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("picker");
    expect(prompt).toContain("warehouse_supervisor");
  });

  it("includes role descriptions", () => {
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain("Picks goods from racks");
  });

  it("includes today's date", () => {
    const prompt = buildSystemPrompt(ctx);
    const today = new Date().toISOString().slice(0, 10);
    expect(prompt).toContain(today);
  });

  it("instructs the LLM to accept input in any language", () => {
    const prompt = buildSystemPrompt(ctx);
    expect(prompt.toLowerCase()).toContain("any language");
  });

  it("instructs the LLM to pick least privileged role when role is vague", () => {
    const prompt = buildSystemPrompt(ctx);
    // Should mention some form of "least privileged" or "basic" guidance
    expect(prompt.toLowerCase()).toMatch(/least|basic|entry/);
  });

  it("handles warehouses with null location gracefully", () => {
    const ctxNullLoc: ProvisioningContext = {
      warehouses: [{ code: "WH-Z", name: "Remote Hub", location: null }],
      roles: [],
    };
    const prompt = buildSystemPrompt(ctxNullLoc);
    expect(prompt).toContain("WH-Z");
    expect(prompt).toContain("Remote Hub");
    // Should not contain "null" as a string
    expect(prompt).not.toContain("| null");
  });
});
```

- [ ] **Step 3: Run tests — verify RED**

```
pnpm vitest run tests/nl-provisioning.test.ts
```

Expected: most tests FAIL because `buildSystemPrompt` ignores `ctx`. Tests for `today` and compile-time shape may pass.

- [ ] **Step 4: Implement `buildSystemPrompt(ctx)` body**

Replace the body of `buildSystemPrompt` in `lib/ai/provisioning.ts`:

```ts
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
```

- [ ] **Step 5: Run tests — verify GREEN**

```
pnpm vitest run tests/nl-provisioning.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```
git add lib/ai/provisioning.ts tests/nl-provisioning.test.ts
git commit -m "feat: enrich NL provisioning system prompt with live warehouse/role context"
```

---

### Task 2: Add `loadProvisioningContext()` and wire into `parseProvisioningIntent`

**Files:**
- Modify: `lib/ai/provisioning.ts`

- [ ] **Step 1: Add `loadProvisioningContext()` function**

Add this function after `buildSystemPrompt` in `lib/ai/provisioning.ts`. It uses the existing `dbAdmin`, `warehouses`, and `roles` imports:

```ts
async function loadProvisioningContext(): Promise<ProvisioningContext> {
  const [warehouseRows, roleRows] = await Promise.all([
    dbAdmin
      .select({ code: warehouses.code, name: warehouses.name, location: warehouses.location })
      .from(warehouses),
    dbAdmin
      .select({ code: roles.code, name: roles.name, description: roles.description })
      .from(roles),
  ]);
  return { warehouses: warehouseRows, roles: roleRows };
}
```

- [ ] **Step 2: Update `parseProvisioningIntent` to call the context loader**

Replace the current `parseProvisioningIntent` body:

```ts
export async function parseProvisioningIntent(text: string): Promise<Intent> {
  const ctx = await loadProvisioningContext();
  const llm = getLLM();
  return await llm.completeJSON(
    [
      { role: "system", content: buildSystemPrompt(ctx) },
      {
        role: "user",
        content: "Convert this request to JSON (schema described above):\n\n" + text,
      },
    ],
    IntentSchema,
    { temperature: 0 },
  );
}
```

- [ ] **Step 3: Run all tests — verify nothing broke**

```
pnpm vitest run
```

Expected: all existing tests PASS (schema tests in `tests/llm-validation.test.ts` are unaffected; new tests still PASS).

- [ ] **Step 4: Commit**

```
git add lib/ai/provisioning.ts
git commit -m "feat: load live warehouses/roles before LLM call for NL provisioning"
```

---

### Task 3: Add fuzzy warehouse fallback in `resolveIntent`

**Files:**
- Modify: `lib/ai/provisioning.ts`

- [ ] **Step 1: Add `ilike` and `or` to the drizzle-orm import**

Change the existing import line at the top of `lib/ai/provisioning.ts`:

```ts
// Before:
import { and, eq } from "drizzle-orm";

// After:
import { and, eq, ilike, or } from "drizzle-orm";
```

- [ ] **Step 2: Replace the warehouse exact-match block in `resolveIntent` with exact + fuzzy fallback**

Find the warehouse resolution block (currently ~lines 73–83). Replace it:

```ts
  // warehouse — exact code match, then fuzzy fallback by name / location
  let wh = (
    await dbAdmin
      .select({ id: warehouses.id })
      .from(warehouses)
      .where(eq(warehouses.code, intent.warehouseCode))
      .limit(1)
  )[0];

  if (!wh) {
    const term = `%${intent.warehouseCode}%`;
    wh = (
      await dbAdmin
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(
          or(
            ilike(warehouses.name, term),
            ilike(warehouses.location, term),
          ),
        )
        .limit(1)
    )[0];
  }

  if (!wh) {
    return {
      ok: false,
      error: `Unknown warehouse '${intent.warehouseCode}'`,
    };
  }
```

- [ ] **Step 3: Run all tests — verify GREEN**

```
pnpm vitest run
```

Expected: all tests PASS. The fuzzy path is a DB-level safety net and is not exercised by unit tests — it will be covered by the manual smoke test below.

- [ ] **Step 4: Commit**

```
git add lib/ai/provisioning.ts
git commit -m "feat: add fuzzy warehouse fallback (ILIKE name/location) in NL provisioning resolveIntent"
```

---

### Task 4: Manual smoke test

**Files:** none

- [ ] **Step 1: Start the dev server**

```
pnpm dev
```

- [ ] **Step 2: Navigate to the NL provisioning form**

Open `http://localhost:3000/warehouse-users/new`. The **"Natural-language provisioning"** card is on the right side of the page — use the textarea there.

- [ ] **Step 3: Test warehouse fuzzy matching**

Submit each request and verify a proposal is created without error:

| Input | Expected warehouse in proposal |
|-------|-------------------------------|
| `Add employee id E999, name Test User, hire today, склад в берлине, any role` | WH-A (Berlin Distribution Center) |
| `Munich warehouse, picker role, employee F001, name Hans Müller` | WH-B (Munich Fulfilment) |
| `Hamburg, any available role, employee G002, name Anna Schmidt` | WH-C (Hamburg Port Hub) |

- [ ] **Step 4: Test vague role handling**

Submit:
```
Create a new worker at WH-A, employee id H100, name Test Worker, hire today, вприницпе на любую роль
```

Expected: proposal created with the least-privileged role (e.g. `picker` or `admin_assistant`).

- [ ] **Step 5: Verify existing exact-code input still works**

Submit:
```
Create a forklift operator at warehouse WH-B with employee id B011, full name Sven Karlsson, hire date today.
```

Expected: proposal created with warehouse WH-B and role `forklift_operator` — same as before.
