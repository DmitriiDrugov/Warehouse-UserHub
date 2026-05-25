import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ dbAdmin: {}, dbReadonly: {} }));

const mockComplete = vi.fn();
vi.mock("@/lib/llm", () => ({
  getLLM: () => ({ complete: mockComplete }),
}));

import { classifyIntent } from "@/lib/ai/classify";

describe("classifyIntent", () => {
  beforeEach(() => {
    mockComplete.mockReset();
  });

  it("detects access explanation questions before calling the LLM", async () => {
    const result = await classifyIntent(
      "\u041f\u043e\u0447\u0435\u043c\u0443 \u0443 Alina Lange \u043d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u0430?",
    );
    expect(result).toBe("access_explain");
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("detects flexible access diagnostic questions", async () => {
    await expect(classifyIntent("What blocks EMP-022 from WMS dispatch?")).resolves.toBe("access_explain");
    await expect(
      classifyIntent("\u041a\u0430\u043a\u0438\u0445 \u043f\u0440\u0430\u0432 \u043d\u0435 \u0445\u0432\u0430\u0442\u0430\u0435\u0442 Alina Lange?"),
    ).resolves.toBe("access_explain");
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("returns 'query' for lookup requests", async () => {
    mockComplete.mockResolvedValueOnce("query");
    const result = await classifyIntent("Show all pickers at WH-A");
    expect(result).toBe("query");
  });

  it("does not hijack aggregate access lookups", async () => {
    mockComplete.mockResolvedValueOnce("query");
    const result = await classifyIntent("Who has WMS access?");
    expect(result).toBe("query");
    expect(mockComplete).toHaveBeenCalled();
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
