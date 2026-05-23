"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { eq } from "drizzle-orm";

import { getSafeAuthRedirectPath } from "@/lib/auth/redirects";
import { getSupabaseServerClient } from "@/lib/auth/supabase-server";
import { dbAdmin } from "@/lib/db/client";
import { appUsers } from "@/lib/db/schema";

const LoginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
  next: z.string().optional(),
});

export type LoginActionState = {
  error?: string;
};

async function getRequestOrigin(): Promise<string> {
  const headerStore = await headers();
  const origin = headerStore.get("origin");
  if (origin) return origin;

  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host");
  const proto = headerStore.get("x-forwarded-proto") ?? "http";
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

export async function signInWithPasswordAction(
  _prev: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues.map((i) => i.message).join("; ") };
  }

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) {
    return { error: error.message };
  }

  if (!data.user) {
    return { error: "Authentication succeeded, but no user session was returned." };
  }

  const [operator] = await dbAdmin
    .select({ id: appUsers.id, isActive: appUsers.isActive })
    .from(appUsers)
    .where(eq(appUsers.authUserId, data.user.id))
    .limit(1);

  if (!operator?.isActive) {
    await supabase.auth.signOut();
    return {
      error:
        "This account is not linked to an active Warehouse UserHub operator profile.",
    };
  }

  redirect(getSafeAuthRedirectPath(parsed.data.next));
}

const OAuthSchema = z.object({
  provider: z.string().min(1),
  next: z.string().optional(),
});

export async function signInWithOAuthAction(formData: FormData): Promise<void> {
  const parsed = OAuthSchema.parse({
    provider: formData.get("provider"),
    next: formData.get("next") ?? undefined,
  });

  const supabase = await getSupabaseServerClient();
  const origin = await getRequestOrigin();
  const next = getSafeAuthRedirectPath(parsed.next);
  const { data, error } = await supabase.auth.signInWithOAuth({
    // Provider types are union literals in the SDK; we pass-through what
    // the operator configured via OAUTH_PROVIDERS.
    provider: parsed.provider as Parameters<
      typeof supabase.auth.signInWithOAuth
    >[0]["provider"],
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });
  if (error) throw new Error(error.message);
  if (data?.url) redirect(data.url);
}
