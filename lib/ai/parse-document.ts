import { z } from "zod";

import { serverEnv } from "../env";
import { extractJsonBlock } from "../llm/json-extract";
import {
  buildSystemPrompt,
  IntentSchema,
  loadProvisioningContext,
  type Intent,
  type ProvisioningContext,
} from "./provisioning";

export const SUPPORTED_DOCUMENT_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type SupportedDocumentMime = (typeof SUPPORTED_DOCUMENT_MIME_TYPES)[number];

export type DocumentExtractionResult = {
  intent: Intent;
  warnings: string[];
};

type ExtractionInput = {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  model?: string;
  notes?: string;
  ctx?: ProvisioningContext;
};

type LooseIntent = {
  employeeId?: string | null;
  fullName?: string | null;
  email?: string | null;
  warehouseCode?: string | null;
  roleCode?: string | null;
  hireDate?: string | null;
  referenceEmployeeId?: string | null;
  extraPermissionCodes?: string[];
};

type OpenRouterResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
};

type AnthropicResponse = {
  content?: Array<{ type: string; text?: string }>;
  error?: { message?: string };
};

type OpenRouterContentPart =
  | { type: "text"; text: string }
  | { type: "file"; file: { filename: string; file_data: string } }
  | { type: "image_url"; image_url: { url: string } };

type AnthropicContentPart =
  | {
      type: "document";
      source: {
        type: "base64";
        media_type: "application/pdf";
        data: string;
      };
    }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: Exclude<SupportedDocumentMime, "application/pdf">;
        data: string;
      };
    }
  | { type: "text"; text: string };

const OPENROUTER_DEFAULT_URL = "https://openrouter.ai/api/v1";
const ANTHROPIC_DEFAULT_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";

export function isSupportedDocumentMime(
  mimeType: string,
): mimeType is SupportedDocumentMime {
  return SUPPORTED_DOCUMENT_MIME_TYPES.includes(
    mimeType.toLowerCase() as SupportedDocumentMime,
  );
}

export async function extractWorkerDataFromDocument(
  input: ExtractionInput,
): Promise<Intent> {
  const result = await extractWorkerProvisioningFromDocument(input);
  return result.intent;
}

export async function extractWorkerProvisioningFromDocument(
  input: ExtractionInput,
): Promise<DocumentExtractionResult> {
  const mimeType = input.mimeType.toLowerCase();
  if (!isSupportedDocumentMime(mimeType)) {
    throw new Error(
      `Unsupported document MIME type '${input.mimeType}'. Upload a PDF, JPG, PNG, or WEBP file.`,
    );
  }

  const ctx = input.ctx ?? (await loadProvisioningContext());
  const env = serverEnv();
  const prompt = buildDocumentExtractionPrompt(ctx, input.fileName, input.notes);

  const raw =
    env.LLM_PROVIDER === "openrouter"
      ? await completeOpenRouterDocument({
          apiKey: env.LLM_API_KEY,
          baseUrl: env.LLM_BASE_URL,
          model: input.model ?? env.LLM_MODEL,
          buffer: input.buffer,
          mimeType,
          fileName: input.fileName,
          prompt,
        })
      : await completeAnthropicDocument({
          apiKey: env.LLM_API_KEY,
          baseUrl: env.LLM_BASE_URL,
          model: resolveAnthropicModel(input.model, env.LLM_MODEL),
          buffer: input.buffer,
          mimeType,
          prompt,
        });

  return parseIntentFromModelOutput(raw, ctx);
}

function buildDocumentExtractionPrompt(
  ctx: ProvisioningContext,
  fileName: string,
  notes?: string,
): string {
  const operatorNotes = notes?.trim();
  return [
    "Extract a new warehouse worker provisioning request from the attached employment document or scan.",
    "Return one JSON object only, using the schema from the provisioning instructions below.",
    "Use visible document fields for employeeId, fullName, email, warehouse, role, and hireDate.",
    "If a field is missing, return null for that field instead of an empty string.",
    "If email is missing, return null. If hireDate is missing, use today's date from the system prompt.",
    "Do not invent extra permissions unless the document explicitly names access, system, or permission codes.",
    `Attached file: ${fileName}`,
    operatorNotes ? `Operator notes: ${operatorNotes}` : "",
    "",
    buildSystemPrompt(ctx),
  ]
    .filter(Boolean)
    .join("\n");
}

function parseIntentFromModelOutput(
  text: string,
  ctx: ProvisioningContext,
): DocumentExtractionResult {
  const candidate = extractJsonBlock(text) ?? text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    throw new Error(
      `Document extraction returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const loose = readLooseIntent(parsed);
  const { intent, warnings } = normalizeExtractedIntent(loose, ctx);

  try {
    return { intent: IntentSchema.parse(intent), warnings };
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issues = err.issues.map((issue) => issue.message).join("; ");
      throw new Error(`Document extraction did not match provisioning schema: ${issues}`);
    }
    throw err;
  }
}

function readLooseIntent(parsed: unknown): LooseIntent {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Document extraction did not return a JSON object");
  }
  const record = parsed as Record<string, unknown>;
  return {
    employeeId: readString(record, ["employeeId", "employeeID", "employee_id", "id"]),
    fullName: readString(record, ["fullName", "employeeName", "employee", "name"]),
    email: readString(record, ["email", "emailAddress"]),
    warehouseCode: readString(record, [
      "warehouseCode",
      "warehouse",
      "warehouseName",
      "placeOfWork",
      "workLocation",
      "location",
    ]),
    roleCode: readString(record, ["roleCode", "role", "position", "jobTitle", "title"]),
    hireDate: readString(record, ["hireDate", "startDate", "employmentStartDate"]),
    referenceEmployeeId: readString(record, [
      "referenceEmployeeId",
      "reference_employee_id",
      "reference",
    ]),
    extraPermissionCodes: readStringArray(record, ["extraPermissionCodes", "permissions"]),
  };
}

function normalizeExtractedIntent(
  loose: LooseIntent,
  ctx: ProvisioningContext,
): DocumentExtractionResult {
  const warnings: string[] = [];
  const fullName = cleanText(loose.fullName);
  if (!fullName) {
    throw new Error("Could not extract the employee name from this document.");
  }

  const hireDate = normalizeDate(cleanText(loose.hireDate));
  if (!cleanText(loose.hireDate)) {
    warnings.push("Hire date was missing in the document, so today's date was used.");
  }

  let employeeId = cleanText(loose.employeeId);
  if (!employeeId) {
    employeeId = makePlaceholderEmployeeId(fullName, hireDate);
    warnings.push(
      `Employee ID was missing in the document, so a temporary ID '${employeeId}' was generated for review.`,
    );
  }

  const rawWarehouse = cleanText(loose.warehouseCode);
  const warehouse = findBestWarehouse(rawWarehouse, ctx.warehouses);
  if (!warehouse) {
    throw new Error("No warehouses are configured, so the document cannot be staged as a proposal.");
  }
  if (!rawWarehouse) {
    warnings.push(`Warehouse was missing in the document, so '${warehouse.code}' was selected for review.`);
  } else if (!isSameCatalogValue(rawWarehouse, warehouse.code, warehouse.name, warehouse.location)) {
    warnings.push(
      `Warehouse '${rawWarehouse}' did not match a configured warehouse exactly, so '${warehouse.code}' was selected for review.`,
    );
  }

  const rawRole = cleanText(loose.roleCode);
  const role = findBestRole(rawRole, ctx.roles);
  if (!role) {
    throw new Error("No roles are configured, so the document cannot be staged as a proposal.");
  }
  if (!rawRole) {
    warnings.push(`Role was missing in the document, so '${role.code}' was selected for review.`);
  } else if (!isSameCatalogValue(rawRole, role.code, role.name, role.description)) {
    warnings.push(
      `Role '${rawRole}' was normalized to configured role '${role.code}'.`,
    );
  }

  const email = cleanText(loose.email);
  const referenceEmployeeId = cleanText(loose.referenceEmployeeId);
  const extraPermissionCodes = (loose.extraPermissionCodes ?? [])
    .map(cleanText)
    .filter((code): code is string => Boolean(code))
    .filter((code) => /^[a-z_]+\.[a-z_]+$/.test(code));

  const intent: Intent = {
    employeeId,
    fullName,
    email: email || null,
    warehouseCode: warehouse.code,
    roleCode: role.code,
    hireDate,
  };
  if (referenceEmployeeId) intent.referenceEmployeeId = referenceEmployeeId;
  if (extraPermissionCodes.length > 0) intent.extraPermissionCodes = extraPermissionCodes;

  return {
    intent,
    warnings,
  };
}

function readString(record: Record<string, unknown>, keys: string[]): string | null | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    if (value === null) return null;
  }
  return undefined;
}

function readStringArray(record: Record<string, unknown>, keys: string[]): string[] | undefined {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string");
    }
  }
  return undefined;
}

function cleanText(value: string | null | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function normalizeDate(value: string | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const isoDate = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;

  const dayMonthYear = value.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/i);
  if (dayMonthYear) {
    const month = monthNumber(dayMonthYear[2]!);
    if (month) return `${dayMonthYear[3]}-${month}-${pad2(dayMonthYear[1]!)}`;
  }

  const monthDayYear = value.match(/^([a-z]+)\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (monthDayYear) {
    const month = monthNumber(monthDayYear[1]!);
    if (month) return `${monthDayYear[3]}-${month}-${pad2(monthDayYear[2]!)}`;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  const date = new Date(parsed);
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
  ].join("-");
}

function monthNumber(value: string): string | undefined {
  const months: Record<string, string> = {
    january: "01",
    jan: "01",
    february: "02",
    feb: "02",
    march: "03",
    mar: "03",
    april: "04",
    apr: "04",
    may: "05",
    june: "06",
    jun: "06",
    july: "07",
    jul: "07",
    august: "08",
    aug: "08",
    september: "09",
    sep: "09",
    october: "10",
    oct: "10",
    november: "11",
    nov: "11",
    december: "12",
    dec: "12",
  };
  return months[value.toLowerCase()];
}

function pad2(value: string | number): string {
  return String(value).padStart(2, "0");
}

function makePlaceholderEmployeeId(fullName: string, hireDate: string): string {
  const slug =
    fullName
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "WORKER";
  return `PENDING-${slug}-${hireDate.replace(/-/g, "")}`;
}

function findBestWarehouse(
  rawValue: string | undefined,
  warehouses: ProvisioningContext["warehouses"],
): ProvisioningContext["warehouses"][number] | undefined {
  return findBestCatalogItem(rawValue, warehouses, (item) => [
    item.code,
    item.name,
    item.location ?? "",
  ]);
}

function findBestRole(
  rawValue: string | undefined,
  roles: ProvisioningContext["roles"],
): ProvisioningContext["roles"][number] | undefined {
  return findBestCatalogItem(rawValue, roles, (item) => [
    item.code,
    item.name,
    item.description ?? "",
  ]);
}

function findBestCatalogItem<T>(
  rawValue: string | undefined,
  items: T[],
  labels: (item: T) => string[],
): T | undefined {
  if (items.length === 0) return undefined;
  if (!rawValue) return items[0];

  const normalizedRaw = normalizeForMatch(rawValue);
  const exact = items.find((item) =>
    labels(item).some((label) => normalizeForMatch(label) === normalizedRaw),
  );
  if (exact) return exact;

  const partial = items.find((item) =>
    labels(item).some((label) => {
      const normalizedLabel = normalizeForMatch(label);
      return (
        normalizedLabel.length > 0 &&
        (normalizedRaw.includes(normalizedLabel) || normalizedLabel.includes(normalizedRaw))
      );
    }),
  );
  return partial ?? items[0];
}

function isSameCatalogValue(
  rawValue: string,
  code: string,
  name: string,
  descriptionOrLocation: string | null,
): boolean {
  const normalizedRaw = normalizeForMatch(rawValue);
  return [code, name, descriptionOrLocation ?? ""].some(
    (value) => normalizeForMatch(value) === normalizedRaw,
  );
}

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function completeOpenRouterDocument(input: {
  apiKey: string;
  baseUrl?: string;
  model: string;
  buffer: Buffer;
  mimeType: SupportedDocumentMime;
  fileName: string;
  prompt: string;
}): Promise<string> {
  const dataUrl = toDataUrl(input.buffer, input.mimeType);
  const attachment: OpenRouterContentPart =
    input.mimeType === "application/pdf"
      ? {
          type: "file",
          file: {
            filename: input.fileName,
            file_data: dataUrl,
          },
        }
      : {
          type: "image_url",
          image_url: {
            url: dataUrl,
          },
        };

  const body: Record<string, unknown> = {
    model: input.model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: input.prompt },
          attachment,
        ] satisfies OpenRouterContentPart[],
      },
    ],
    temperature: 0,
    max_tokens: 800,
    response_format: { type: "json_object" },
  };

  if (input.mimeType === "application/pdf") {
    body.plugins = [
      {
        id: "file-parser",
        pdf: { engine: "cloudflare-ai" },
      },
    ];
  }

  const json = await postJson<OpenRouterResponse>(
    `${(input.baseUrl ?? OPENROUTER_DEFAULT_URL).replace(/\/$/, "")}/chat/completions`,
    {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/warehouse-userhub",
      "X-Title": "Warehouse UserHub",
    },
    body,
    "OpenRouter",
  );

  if (json.error) {
    throw new Error(`OpenRouter error: ${json.error.message ?? "unknown"}`);
  }

  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("OpenRouter returned empty document extraction content");
  }
  return content;
}

async function completeAnthropicDocument(input: {
  apiKey: string;
  baseUrl?: string;
  model: string;
  buffer: Buffer;
  mimeType: SupportedDocumentMime;
  prompt: string;
}): Promise<string> {
  const base64 = input.buffer.toString("base64");
  const attachment: AnthropicContentPart =
    input.mimeType === "application/pdf"
      ? {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: base64,
          },
        }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: input.mimeType,
            data: base64,
          },
        };

  const json = await postJson<AnthropicResponse>(
    `${(input.baseUrl ?? ANTHROPIC_DEFAULT_URL).replace(/\/$/, "")}/messages`,
    {
      "x-api-key": input.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    {
      model: input.model,
      max_tokens: 800,
      temperature: 0,
      system: "Return JSON only. No prose, no markdown fences.",
      messages: [
        {
          role: "user",
          content: [
            attachment,
            { type: "text", text: input.prompt },
          ] satisfies AnthropicContentPart[],
        },
      ],
    },
    "Anthropic",
  );

  if (json.error) {
    throw new Error(`Anthropic error: ${json.error.message ?? "unknown"}`);
  }

  const content = (json.content ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text!)
    .join("");

  if (content.length === 0) {
    throw new Error("Anthropic returned empty document extraction content");
  }
  return content;
}

async function postJson<T>(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  providerName: string,
): Promise<T> {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), 60_000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: timeoutController.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${providerName} ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

function toDataUrl(buffer: Buffer, mimeType: SupportedDocumentMime): string {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function resolveAnthropicModel(model: string | undefined, fallback: string): string {
  const candidate = model && !model.includes("/") ? model : fallback;
  if (candidate === "anthropic/claude-3-haiku") return "claude-3-haiku-20240307";
  if (candidate.startsWith("anthropic/")) return candidate.slice("anthropic/".length);
  return candidate;
}
