/**
 * LLM-output validation tests (§11). Verifies that the proposal payload
 * Zod schemas reject malformed AI output and that the JSON extractor
 * tolerates the common wrappings (fenced code blocks, prose, raw object).
 */

import { describe, expect, it } from "vitest";

import { extractJsonBlock } from "@/lib/llm/json-extract";
import {
  AnomalyFlagPayload,
  OffboardCompletenessPayload,
  ProvisionPayload,
  RevokeAccessPayload,
} from "@/lib/validation/proposals";

const A_UUID = "11111111-1111-1111-1111-111111111111";
const B_UUID = "22222222-2222-2222-2222-222222222222";

describe("extractJsonBlock", () => {
  it("extracts JSON inside a ```json fence", () => {
    expect(extractJsonBlock("here:\n```json\n{\"a\":1}\n```")).toBe('{"a":1}');
  });
  it("extracts JSON inside an unlabelled fence", () => {
    expect(extractJsonBlock("```\n{\"a\":1}\n```")).toBe('{"a":1}');
  });
  it("returns the trimmed string when it starts with {", () => {
    expect(extractJsonBlock('  {"a":1}  ')).toBe('{"a":1}');
  });
  it("finds the first balanced { ... } in prose", () => {
    expect(extractJsonBlock('Here is the result: {"a":{"b":2}} done.')).toBe(
      '{"a":{"b":2}}',
    );
  });
  it("returns null when no JSON-ish substring exists", () => {
    expect(extractJsonBlock("nothing useful here")).toBeNull();
  });
});

describe("ProvisionPayload", () => {
  it("accepts a well-formed payload", () => {
    const res = ProvisionPayload.parse({
      employeeId: "X100",
      fullName: "Test User",
      warehouseId: A_UUID,
      roleId: B_UUID,
      hireDate: "2026-05-01",
    });
    expect(res.employeeId).toBe("X100");
  });
  it("rejects a non-UUID warehouseId", () => {
    expect(() =>
      ProvisionPayload.parse({
        employeeId: "X100",
        fullName: "Test User",
        warehouseId: "not-a-uuid",
        roleId: B_UUID,
        hireDate: "2026-05-01",
      }),
    ).toThrow();
  });
  it("rejects an invalid hireDate", () => {
    expect(() =>
      ProvisionPayload.parse({
        employeeId: "X100",
        fullName: "Test User",
        warehouseId: A_UUID,
        roleId: B_UUID,
        hireDate: "not-a-date",
      }),
    ).toThrow();
  });
});

describe("RevokeAccessPayload", () => {
  it("requires at least one access id", () => {
    expect(() =>
      RevokeAccessPayload.parse({
        warehouseUserId: A_UUID,
        accessIds: [],
        reason: "x",
      }),
    ).toThrow();
  });
  it("accepts a single-uuid list", () => {
    const res = RevokeAccessPayload.parse({
      warehouseUserId: A_UUID,
      accessIds: [B_UUID],
      reason: "expired cert",
    });
    expect(res.accessIds).toEqual([B_UUID]);
  });
});

describe("AnomalyFlagPayload", () => {
  it("rejects unknown anomaly types", () => {
    expect(() =>
      AnomalyFlagPayload.parse({
        warehouseUserId: A_UUID,
        anomalyType: "made_up",
        details: {},
      }),
    ).toThrow();
  });
  it("accepts a known anomaly type", () => {
    const res = AnomalyFlagPayload.parse({
      warehouseUserId: A_UUID,
      anomalyType: "dormant_access",
      details: { since: "2025-01-01" },
    });
    expect(res.anomalyType).toBe("dormant_access");
  });
});

describe("OffboardCompletenessPayload", () => {
  it("accepts empty access/cert lists with empty extras", () => {
    const res = OffboardCompletenessPayload.parse({
      warehouseUserId: A_UUID,
      accessIds: [],
      certificateIds: [],
      extras: [],
    });
    expect(res.warehouseUserId).toBe(A_UUID);
  });
  it("rejects an extras entry missing description", () => {
    expect(() =>
      OffboardCompletenessPayload.parse({
        warehouseUserId: A_UUID,
        accessIds: [],
        certificateIds: [],
        extras: [{ kind: "badge" }],
      }),
    ).toThrow();
  });
});
