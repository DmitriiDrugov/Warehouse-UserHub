import { describe, expect, it } from "vitest";

import { aiChatMessages } from "@/lib/db/schema";

describe("aiChatMessages table", () => {
  it("is exported from schema", () => {
    expect(aiChatMessages).toBeDefined();
  });

  it("has expected columns", () => {
    const cols = Object.keys(aiChatMessages);
    expect(cols).toContain("operatorId");
    expect(cols).toContain("role");
    expect(cols).toContain("content");
    expect(cols).toContain("result");
    expect(cols).toContain("createdAt");
  });
});
