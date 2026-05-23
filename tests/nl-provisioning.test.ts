import { describe, expect, it, vi } from "vitest";

// Mock heavy server-side dependencies so env vars are not required
vi.mock("@/lib/db/client", () => ({ dbAdmin: {}, dbReadonly: {} }));
vi.mock("@/lib/llm", () => ({ getLLM: () => ({}) }));
vi.mock("@/lib/services/proposals", () => ({ createProposal: vi.fn() }));

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
    expect(prompt).not.toContain("| null");
  });

  it("handles empty warehouse and role lists gracefully", () => {
    const emptyCtx: ProvisioningContext = { warehouses: [], roles: [] };
    const prompt = buildSystemPrompt(emptyCtx);
    // Headers still appear
    expect(prompt).toContain("Available warehouses");
    expect(prompt).toContain("Available roles");
    // No garbage like "undefined" or "null"
    expect(prompt).not.toContain("undefined");
    expect(prompt).not.toContain("| null");
    // Date rule still present
    const today = new Date().toISOString().slice(0, 10);
    expect(prompt).toContain(today);
  });
});
