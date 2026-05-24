import { describe, expect, it } from "vitest";

import { buildExcelCsv, makeCsvReportFileName } from "@/lib/reports/csv";

describe("buildExcelCsv", () => {
  it("adds an Excel separator hint and UTF-8 BOM", () => {
    const csv = buildExcelCsv(["name"], [{ name: "Anna" }]);

    expect(csv).toBe("\uFEFFsep=,\r\nname\r\nAnna\r\n");
  });

  it("escapes commas, quotes, and line breaks", () => {
    const csv = buildExcelCsv(
      ["name", "note"],
      [{ name: 'Ivan "V"', note: "WH-A, Zone 1\nready" }],
    );

    expect(csv).toContain('"Ivan ""V"""');
    expect(csv).toContain('"WH-A, Zone 1\nready"');
  });

  it("keeps column order and serializes objects", () => {
    const csv = buildExcelCsv(
      ["id", "meta"],
      [{ meta: { role: "picker" }, id: "EMP-001" }],
    );

    expect(csv).toContain('EMP-001,"{""role"":""picker""}"');
  });

  it("guards string values that Excel could treat as formulas", () => {
    const csv = buildExcelCsv(
      ["employee_id", "count"],
      [{ employee_id: "=cmd()", count: -42 }],
    );

    expect(csv).toContain("'=cmd(),-42");
  });
});

describe("makeCsvReportFileName", () => {
  it("uses a stable timestamped csv name", () => {
    const name = makeCsvReportFileName(new Date("2026-05-24T19:30:15.123Z"));

    expect(name).toBe("warehouse-ai-report-2026-05-24T19-30-15.csv");
  });
});
