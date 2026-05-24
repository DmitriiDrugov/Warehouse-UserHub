import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ dbAdmin: {}, dbReadonly: {} }));

const mockComplete = vi.fn();
vi.mock("@/lib/llm", () => ({
  getLLM: () => ({ complete: mockComplete }),
}));

import { classifyIntent } from "@/lib/ai/classify";

describe("classifyIntent", () => {
  it("returns 'query' for lookup requests", async () => {
    mockComplete.mockResolvedValueOnce("query");
    const result = await classifyIntent("Show all pickers at WH-A");
    expect(result).toBe("query");
  });

  it("returns 'provision' for creation requests", async () => {
    mockComplete.mockResolvedValueOnce("provision");
    const result = await classifyIntent("Create a new forklift operator");
    expect(result).toBe("provision");
  });

  it("returns 'unsupported' for unknown requests", async () => {
    mockComplete.mockResolvedValueOnce("unsupported");
    const result = await classifyIntent("Delete all warehouse data");
    expect(result).toBe("unsupported");
  });

  it("defaults to 'unsupported' if LLM returns garbage", async () => {
    mockComplete.mockResolvedValueOnce("GARBAGE_RESPONSE_XYZ");
    const result = await classifyIntent("some text");
    expect(result).toBe("unsupported");
  });

  it("passes model override to getLLM().complete", async () => {
    mockComplete.mockResolvedValueOnce("query");
    await classifyIntent("show workers", "claude-opus-4-7");
    expect(mockComplete).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ model: "claude-opus-4-7", maxTokens: 10 }),
    );
  });

  it("returns 'unsupported' if LLM throws", async () => {
    mockComplete.mockRejectedValueOnce(new Error("network error"));
    await expect(classifyIntent("anything")).resolves.toBe("unsupported");
  });
});
