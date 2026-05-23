/**
 * Auth middleware. Runs on every request before it hits the route, refreshes
 * the Supabase session cookie, and redirects unauthenticated traffic to
 * /login (except for public paths and public assets, which are filtered out
 * by this file and by the `matcher` in middleware.ts at the project root).
 */

import { type CookieOptions, createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// Routes that should bypass the operator-session check entirely.
//   /login         — the login form itself
//   /auth/callback — OAuth code exchange
//   /api/cron      — scheduled jobs (protected by CRON_SECRET bearer token instead)
//   /logout        — POST handler clears session, then redirects
const PUBLIC_PATHS = ["/login", "/auth/callback", "/api/cron", "/logout"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Trigger session refresh as a side-effect.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}
