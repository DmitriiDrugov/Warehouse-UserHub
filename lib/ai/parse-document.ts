/**
 * Extract warehouse worker registration data from an uploaded document
 * (PDF or image) using Claude's vision/document API.
 *
 * Uses the Anthropic API directly (raw fetch) because the LLMProvider
 * abstraction only supports text-only messages. Only works when
 * LLM_PROVIDER=anthropic (or if a model override pointing to Anthropic is given).
 *
 * Returns the same Intent shape as provisioning.ts so it flows through
 * the same resolveIntent() logic.
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

/**
 * Call the Anthropic API directly with a document content block so Claude
 * can read the file and extract worker data.
 */
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

  // Anthropic content block type depends on MIME:
  // PDFs → { type: "document", source: { type: "base64", media_type, data } }
  // Images → { type: "image", source: { type: "base64", media_type, data } }
  const contentBlock =
    mimeType === "application/pdf"
      ? {
          type: "document",
          source: { type: "base64", media_type: mimeType, data: base64 },
        }
      : {
          type: "image",
          source: { type: "base64", media_type: mimeType, data: base64 },
        };

  const baseUrl = (env.LLM_BASE_URL ?? "https://api.anthropic.com/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/messages`, {
    method: "POST",
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
            {
              type: "text",
              text: "Extract worker registration data from this document and output JSON only (schema as described in the system prompt).",
            },
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

  if (data.error) {
    throw new Error(`Anthropic error: ${data.error.message ?? "unknown"}`);
  }

  const textBlock = data.content?.find((b) => b.type === "text");
  if (!textBlock?.text) {
    throw new Error("Anthropic returned no text content");
  }

  // Use the shared tolerant extractor — handles prose-before-fence, raw JSON, etc.
  const raw = extractJsonBlock(textBlock.text) ?? textBlock.text.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Could not parse JSON from document extraction: ${raw.slice(0, 200)}`);
  }

  return IntentFromDocSchema.parse(parsed);
}
