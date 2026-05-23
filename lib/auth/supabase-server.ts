/**
 * Supabase server-side client. Server Components, Server Actions, and
 * route handlers all go through `getSupabaseServerClient()`.
 *
 * The cookie store is read/written via Next 15's async `cookies()` helper.
 * `@supabase/ssr` requires us to forward `getAll()` and `setAll()` so the
 * client can refresh the session JWT on demand.
 */

import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "../env";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    publicEnv().NEXT_PUBLIC_SUPABASE_URL,
    publicEnv().NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // `cookies().set` throws when called from a Server Component
            // (you can only write cookies in Server Actions or route handlers).
            // The middleware refreshes the session in those cases, so we can
            // safely ignore the error here.
          }
        },
      },
    },
  );
}
