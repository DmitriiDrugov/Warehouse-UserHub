import { type NextRequest } from "next/server";
import { updateSession } from "./lib/auth/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     *   - _next/static (build assets)
     *   - _next/image (image optimization)
     *   - favicon.ico
     *   - any file with an extension (e.g. .png, .css)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js|woff|woff2|ttf)$).*)",
  ],
};
