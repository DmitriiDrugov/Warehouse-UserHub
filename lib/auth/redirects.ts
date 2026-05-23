const DEFAULT_AUTH_REDIRECT = "/dashboard";

export function getSafeAuthRedirectPath(next?: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return DEFAULT_AUTH_REDIRECT;
  }

  try {
    const url = new URL(next, "http://localhost");
    if (url.pathname === "/login" || url.pathname.startsWith("/login/")) {
      return DEFAULT_AUTH_REDIRECT;
    }
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_AUTH_REDIRECT;
  }
}
