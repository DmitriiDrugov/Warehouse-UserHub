export type CsvRow = Record<string, unknown>;

export function buildExcelCsv(columns: string[], rows: CsvRow[]): string {
  const lines = [
    "sep=,",
    columns.map((column) => toCsvCell(column)).join(","),
    ...rows.map((row) =>
      columns.map((column) => toCsvCell(row[column])).join(","),
    ),
  ];

  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export function makeCsvReportFileName(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `warehouse-ai-report-${stamp}.csv`;
}

function toCsvCell(value: unknown): string {
  const text = normalizeValue(value);
  const safeText = guardExcelFormula(text, value);
  const escaped = safeText.replace(/"/g, '""');

  if (/[",\r\n]/.test(escaped) || escaped !== escaped.trim()) {
    return `"${escaped}"`;
  }

  return escaped;
}

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function guardExcelFormula(text: string, originalValue: unknown): string {
  if (typeof originalValue !== "string") return text;
  return /^[\t\r\n ]*[=+\-@]/.test(text) ? `'${text}` : text;
}
