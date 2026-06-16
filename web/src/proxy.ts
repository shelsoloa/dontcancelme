import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Refreshes the Supabase session on every request (the proxy pattern from the
 * SSR guide) and guards the user portal. Must return the `response` object so
 * refreshed auth cookies reach the browser. (Next 16 "proxy" = former middleware.)
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, // use publishable key var
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers ?? {}).forEach(([key, value]) => {
            response.headers.set(key, value);
          });
        },
      },
    },
  );

  // Refresh/validate auth state in SSR-safe way
  const { data: claimsData, error } = await supabase.auth.getClaims();
  const isAuthed = !error && !!claimsData?.claims;

  if (!isAuthed && request.nextUrl.pathname.startsWith("/portal")) {
    const url = request.nextUrl.clone();
    url.pathname = "/start";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except ALL Next internals (incl. the HMR websocket
    // `_next/webpack-hmr`, which the proxy must not touch) and static assets.
    "/((?!_next/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
