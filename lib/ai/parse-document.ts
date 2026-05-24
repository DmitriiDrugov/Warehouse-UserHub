/**
 * Extract warehouse worker registration data from an uploaded document
 * (PDF or image) using Claude's vision API.
 *
 * Supports two providers:
 *   - openrouter: OpenAI-compatible format with image_url (base64 data URL)
 *   - anthropic:  Native Anthropic format with document/image content blocks
 */

import { z } from "zod";
import { serverEnv } from "../env";
import { extractJsonBlock } from "../llm/json-extract";
import { buildSystemPrompt, loadProvisioningContext } from "./provisioning";

export const SUPPORTED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
type SupportedMime = (typeof SUPPORTED_MIME_TYPES)[number];

function isSupportedMime(mime: string): mime is SupportedMime {
  return (SUPPORTED_MIME_TYPES as readonly string[]).includes(mime);
}

const IntentFromDocSchema = z.object({
  employeeId: z.string().min(1),
  fullName: z.string().min(1),
  email: z.string().email().nullable().optional(),
  warehouseCode: z.string().min(1),
  roleCode: z.string().min(1),
  hireDate: z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), "hireDate must be ISO date"),
  referenceEmployeeId: z.string().min(1).nullable().optional(),
  extraPermissionCodes: z
    .array(z.string().regex(/^[a-z_]+\.[a-z_]+$/))
    .optional(),
});

export type DocumentIntent = z.infer<typeof IntentFromDocSchema>;

export async function extractWorkerDataFromDocument(
  buffer: Buffer,
  mimeType: string,
  model: string,
): Promise<DocumentIntent> {
  if (!isSupportedMime(mimeType)) {
    throw new Error(
      `Unsupported document MIME type: ${mimeType}. Use PDF, JPEG, PNG, or WebP.`,
    );
  }

  const env = serverEnv();
  const ctx = await loadProvisioningContext();
  const systemPrompt =
    "Extract warehouse worker registration data from the attached document.\n\n" +
    buildSystemPrompt(ctx);
  const base64 = buffer.toString("base64");
  const extractInstruction =
    "Extract worker registration data from this document and output JSON only (schema as described in the system prompt).";

  let rawText: string;

  if (env.LLM_PROVIDER === "openrouter") {
    rawText = await callOpenRouter({ env, model, base64, mimeType, systemPrompt, extractInstruction });
  } else {
    rawText = await callAnthropic({ env, model, base64, mimeType, systemPrompt, extractInstruction });
  }

  const raw = extractJsonBlock(rawText) ?? rawText.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Could not parse JSON from document extraction: ${raw.slice(0, 200)}`);
  }

  return IntentFromDocSchema.parse(parsed);
}

// ─── OpenRouter (OpenAI-compatible endpoint, Claude pass-through) ────────────

async function callOpenRouter(opts: {
  env: ReturnType<typeof serverEnv>;
  model: string;
  base64: string;
  mimeType: string;
  systemPrompt: string;
  extractInstruction: string;
}): Promise<string> {
  const { env, model, base64, mimeType, systemPrompt, extractInstruction } = opts;
  const baseUrl = (env.LLM_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");

  // For PDFs, use the native Anthropic document block — OpenRouter passes it
  // through to Claude unchanged. For images, use the standard image_url format.
  const fileBlock =
    mimeType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: mimeType, data: base64 } }
      : { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.LLM_API_KEY}`,
        "HTTP-Referer": "https://github.com/warehouse-userhub",
        "X-Title": "Warehouse UserHub",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 2048,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              fileBlock,
              { type: "text", text: extractInstruction },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`OpenRouter API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
      error?: { message?: string };
    };

    if (data.error) throw new Error(`OpenRouter error: ${data.error.message ?? "unknown"}`);

    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenRouter returned empty content");
    return content;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Document parsing timed out (90 s). The file may be too large or the service is unavailable.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Anthropic native format ──────────────────────────────────────────────────

async function callAnthropic(opts: {
  env: ReturnType<typeof serverEnv>;
  model: string;
  base64: string;
  mimeType: string;
  systemPrompt: string;
  extractInstruction: string;
}): Promise<string> {
  const { env, model, base64, mimeType, systemPrompt, extractInstruction } = opts;
  const baseUrl = (env.LLM_BASE_URL ?? "https://api.anthropic.com/v1").replace(/\/$/, "");

  const contentBlock =
    mimeType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: mimeType, data: base64 } }
      : { type: "image", source: { type: "base64", media_type: mimeType, data: base64 } };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);

  try {
    const response = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.LLM_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "pdfs-2024-09-25",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        temperature: 0,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: [
              contentBlock,
              { type: "text", text: extractInstruction },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Anthropic API error ${response.status}: ${body}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      error?: { message?: string };
    };

    if (data.error) throw new Error(`Anthropic error: ${data.error.message ?? "unknown"}`);

    const textBlock = data.content?.find((b) => b.type === "text");
    if (!textBlock?.text) throw new Error("Anthropic returned no text content");
    return textBlock.text;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Document parsing timed out (90 s). The file may be too large or the service is unavailable.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
