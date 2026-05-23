# Flexible Natural-Language Provisioning

**Date:** 2026-05-24  
**Scope:** `lib/ai/provisioning.ts`  
**Status:** Approved

---

## Problem

The NL provisioning pipeline currently requires the user to know and type exact internal codes:

- Warehouse: `WH-A`, `WH-B`, `WH-C`
- Role: `forklift_operator`, `picker`, etc.

This is because the LLM receives no information about what warehouses or roles exist — it must guess the code, and `resolveIntent` does a strict exact-match `WHERE code = ?` lookup. Any deviation causes an "Unknown warehouse code" / "Unknown role code" error.

Users want to say things like:
- "склад в берлине" (warehouse in Berlin)
- "на любую доступную роль" (any available role)
- "вприницпе на любую" (basically any)
- Free-form, any language, any phrasing

---

## Root Cause

`buildSystemPrompt()` produces a static string with no live data. The LLM has zero awareness of what warehouses, roles, or their human-readable names/locations look like.

---

## Solution: Context-Enriched System Prompt

### Overview

Before calling the LLM, load the full list of warehouses and roles from the database and inject them into the system prompt. The LLM can then:

1. **Fuzzy-match warehouses** — "Berlin" → `WH-A`, "München" → `WH-B`, "порт Гамбург" → `WH-C`
2. **Pick the least-privileged role** when the user says "any role" / "any available" / "любую"

The LLM always outputs a valid code from the list it was given — no guessing, no hallucination.

### Architecture

```
proposeProvision(text)
  └─ parseProvisioningIntent(text)
       ├─ loadProvisioningContext()          ← NEW: DB query for warehouses + roles
       ├─ buildSystemPrompt(ctx)             ← CHANGED: accepts context, injects list
       └─ llm.completeJSON(...)              ← unchanged, but now LLM is informed
  └─ resolveIntent(intent)
       ├─ exact code match (warehouses)      ← unchanged
       ├─ fuzzy fallback: ILIKE name/location ← NEW: safety net
       ├─ exact code match (roles)           ← unchanged
       └─ ... rest unchanged
```

### New: `loadProvisioningContext()`

```ts
type ProvisioningContext = {
  warehouses: { code: string; name: string; location: string | null }[];
  roles: { code: string; name: string; description: string | null }[];
};

async function loadProvisioningContext(): Promise<ProvisioningContext>
```

Fetches all rows from `warehouses` (code, name, location) and `roles` (code, name, description). Lightweight — two small table scans on catalog data.

### Changed: `buildSystemPrompt(ctx)`

The prompt now includes:

```
Available warehouses (use the exact code in your JSON output):
  WH-A | Berlin Distribution Center | Berlin, DE
  WH-B | Munich Fulfilment           | München, DE
  WH-C | Hamburg Port Hub            | Hamburg, DE

Available roles (use the exact code in your JSON output):
  picker             | Order picker             | Picks goods from racks
  admin_assistant    | Administrative assistant | Back-office support
  forklift_operator  | Forklift operator        | Operates counterbalance forklifts
  lift_truck_operator| Reach-truck / lift operator | Operates reach trucks
  warehouse_supervisor| Warehouse supervisor     | Shift supervisor

Rules:
- Match warehouses by city name, location, or warehouse name — output the matching code.
- If the user does not specify a role, or says "any role" / "any available" / "любую" /
  similar vague phrasing in any language — pick the LEAST privileged role from the list above.
- Input may be in any language (Russian, German, English, etc.) — always output JSON in English.
- Output JSON only — no prose.
```

Roles are ordered least-to-most privileged in the prompt so the LLM's "pick first when unsure" heuristic aligns with the desired behavior.

### Changed: `resolveIntent()` — fuzzy warehouse fallback

After the exact `WHERE code = ?` lookup fails, add a case-insensitive substring search on `name` and `location`:

```ts
// 1. Exact code match
const [wh] = await db.select().from(warehouses).where(eq(warehouses.code, intent.warehouseCode));

// 2. Fuzzy fallback (safety net — should rarely trigger with enriched prompt)
if (!wh) {
  const [fuzzy] = await db.select().from(warehouses).where(
    or(
      ilike(warehouses.name, `%${intent.warehouseCode}%`),
      ilike(warehouses.location, `%${intent.warehouseCode}%`),
    )
  );
  if (!fuzzy) return { ok: false, error: `Unknown warehouse '${intent.warehouseCode}'` };
  wh = fuzzy;
}
```

This handles the edge case where the LLM returns a city name ("Berlin") instead of a code despite the enriched prompt.

---

## What Does NOT Change

| Component | Change |
|-----------|--------|
| `IntentSchema` | No change — same fields, LLM now produces correct codes |
| `resolveIntent` role lookup | No change — LLM always picks a valid code from the list |
| `nl-provision-form.tsx` | No change |
| `actions.ts` | No change |
| `proposeProvision` return shape | No change |
| Zod validation schemas | No change |
| Tests in `llm-validation.test.ts` | No change — they test schemas, not LLM output |

---

## Behavior Examples After Change

| User input | LLM resolves | Result |
|-----------|-------------|--------|
| "склад в берлине" | `warehouseCode: "WH-A"` | ✅ |
| "Munich warehouse" | `warehouseCode: "WH-B"` | ✅ |
| "порт Гамбург" | `warehouseCode: "WH-C"` | ✅ |
| "на любую роль" | `roleCode: "picker"` (least privileged) | ✅ |
| "вприницпе на любую" | `roleCode: "picker"` | ✅ |
| "any available role" | `roleCode: "picker"` | ✅ |
| "WH-B forklift_operator" | unchanged exact codes | ✅ |

---

## Failure Modes

| Situation | Behavior |
|-----------|----------|
| Warehouse genuinely ambiguous (e.g. "склад") | LLM picks one; resolveIntent succeeds; proposal shows details for operator to review |
| Warehouse not found even after fuzzy | `{ ok: false, error: "Unknown warehouse '...'" }` — same as today |
| Role not found (edge case if LLM hallucinates) | `{ ok: false, error: "Unknown role code '...'" }` — same as today |

---

## Files Changed

- `lib/ai/provisioning.ts` — only file touched
