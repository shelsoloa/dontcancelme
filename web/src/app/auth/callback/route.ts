import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { captureXConnection } from "@/lib/x/oauth";

/**
 * OAuth / email auth callback. Handles the PKCE `code` flow (X login) and the
 * `token_hash` OTP flow (email links), then redirects to `next`. On X login we
 * also capture the provider tokens into `connection_secrets` (encrypted) so the
 * audit can later call the X API on the user's behalf.
 *
 * Redirects are built from the request's Host header, NOT `new URL(request.url)`
 * — in dev the latter normalizes to `localhost` even when the browser used
 * `127.0.0.1`, which would bounce the freshly-set session cookies to a different
 * origin and silently log the user out.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const searchParams = url.searchParams;
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto =
    request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const origin = host ? `${proto}://${host}` : url.origin;

  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/portal/scans";

  const supabase = await createClient();

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (data.session?.provider_token) {
        // Best-effort: a capture failure must not block sign-in.
        try {
          await captureXConnection(data.session);
        } catch (e) {
          console.error("Failed to capture X connection:", e);
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error("exchangeCodeForSession failed:", error.message);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    console.error("verifyOtp failed:", error.message);
  }

  return NextResponse.redirect(`${origin}/start?error=auth`);
}
