import { z } from "zod";

/**
 * Centralized env access. Every other module that needs an env var imports from here.
 * Validates on first access; throws a single descriptive error on misconfiguration.
 *
 * Split into `serverEnv` (server-only, must never be imported from a "use client" file)
 * and `publicEnv` (browser-safe, NEXT_PUBLIC_* only).
 */

const serverSchema = z.object({
  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Database
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_READONLY: z.string().min(1),

  // LLM
  LLM_PROVIDER: z.enum(["openrouter", "anthropic"]),
  LLM_MODEL: z.string().min(1),
  LLM_API_KEY: z.string().min(1),
  LLM_BASE_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),

  // Cron
  CRON_SECRET: z.string().min(16, "CRON_SECRET must be at least 16 chars"),

  // OAuth (optional)
  OAUTH_PROVIDERS: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    ),

  // Tuning
  NL_SQL_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  NL_SQL_MAX_ROWS: z.coerce.number().int().positive().default(200),
  ANOMALY_DORMANT_DAYS: z.coerce.number().int().positive().default(90),
  OFFBOARDING_SLA_HOURS: z.coerce.number().int().positive().default(24),
  PROPOSAL_EXPIRY_DAYS: z.coerce.number().int().positive().default(30),
});

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export type ServerEnv = z.infer<typeof serverSchema>;
export type PublicEnv = z.infer<typeof publicSchema>;

let cachedServerEnv: ServerEnv | undefined;
let cachedPublicEnv: PublicEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid server environment:\n${issues}`);
  }
  cachedServerEnv = parsed.data;
  return cachedServerEnv;
}

export function publicEnv(): PublicEnv {
  if (cachedPublicEnv) return cachedPublicEnv;
  const source = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
  const parsed = publicSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid public environment:\n${issues}`);
  }
  cachedPublicEnv = parsed.data;
  return cachedPublicEnv;
}
