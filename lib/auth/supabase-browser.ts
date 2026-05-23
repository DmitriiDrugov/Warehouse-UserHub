/**
 * Supabase browser client. Used only by client components (e.g. the
 * login form's OAuth redirect handler). Reads only NEXT_PUBLIC_*.
 */

"use client";

import { createBrowserClient } from "@supabase/ssr";

let cached: ReturnType<typeof createBrowserClient> | undefined;

export function getSupabaseBrowserClient() {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set",
    );
  }
  cached = createBrowserClient(url, anonKey);
  return cached;
}
