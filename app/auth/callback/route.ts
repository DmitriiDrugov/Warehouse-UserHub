import { eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";

import { getSafeAuthRedirectPath } from "@/lib/auth/redirects";
import { getSupabaseServerClient } from "@/lib/auth/supabase-server";
import { dbAdmin } from "@/lib/db/client";
import { appUsers } from "@/lib/db/schema";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = getSafeAuthRedirectPath(url.searchParams.get("next"));

  if (!code) {
    // No OAuth code — nothing to exchange; send straight to login.
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("error", error.message);
    return NextResponse.redirect(redirectUrl);
  }

  // Mirror the check performed by signInWithPasswordAction: the Supabase
  // auth user must map to an *active* app_users row. If not, sign out
  // immediately so the JWT is invalidated and the user sees a clear error
  // rather than being bounced back and forth without explanation.
  if (data.user) {
    const [operator] = await dbAdmin
      .select({ id: appUsers.id, isActive: appUsers.isActive })
      .from(appUsers)
      .where(eq(appUsers.authUserId, data.user.id))
      .limit(1);

    if (!operator?.isActive) {
      await supabase.auth.signOut();
      const redirectUrl = new URL("/login", request.url);
      redirectUrl.searchParams.set(
        "error",
        "This account is not linked to an active Warehouse UserHub operator profile.",
      );
      return NextResponse.redirect(redirectUrl);
    }
  }

  return NextResponse.redirect(new URL(next, request.url));
}
