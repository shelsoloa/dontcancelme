import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidToken, resolveConnectionId } from "@/lib/x/oauth";
import {
  getMe,
  deleteTweet,
  unlikeTweet,
  unretweet,
  XApiError,
} from "@/lib/x/api";
import type { AuditSource } from "@/lib/audit/types";

export const runtime = "nodejs";

type DeleteBody = {
  platformPostId: string;
  auditSource: AuditSource;
};

/**
 * Delete / unlike / un-repost a single tweet on the user's behalf.
 *
 * POST /api/x/delete
 * Body: { platformPostId: string, auditSource: AuditSource }
 *
 * - own_text / own_images → delete the tweet
 * - likes               → unlike the tweet
 * - reposts             → un-repost
 *
 * Logs success/failure to deletion_log. No credits are charged.
 */
export async function POST(request: Request) {
  let body: DeleteBody;
  try {
    body = (await request.json()) as DeleteBody;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const { platformPostId, auditSource } = body;
  if (!platformPostId || !auditSource) {
    return NextResponse.json({ error: "missing platformPostId or auditSource" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const connectionId = await resolveConnectionId(user.id);
  if (!connectionId) {
    return NextResponse.json({ error: "no_connection" }, { status: 409 });
  }

  let token: string;
  try {
    token = await getValidToken(connectionId);
  } catch {
    console.error("[delete] getValidToken failed for connection:", connectionId);
    return NextResponse.json({ error: "token_unavailable" }, { status: 409 });
  }

  try {
    switch (auditSource) {
      case "own_text":
      case "own_images":
        await deleteTweet(token, platformPostId);
        break;
      case "likes":
      case "reposts": {
        let me;
        try {
          me = await getMe(token);
        } catch (e) {
          console.error("[delete] getMe failed:", e);
          const status = e instanceof XApiError ? 502 : 500;
          return NextResponse.json({ error: "x_api_error" }, { status });
        }
        if (auditSource === "likes") {
          await unlikeTweet(token, me.id, platformPostId);
        } else {
          await unretweet(token, me.id, platformPostId);
        }
        break;
      }
      default:
        return NextResponse.json({ error: "unknown_audit_source" }, { status: 400 });
    }

    console.log("[delete] success:", auditSource, platformPostId);
    // Log success
    const admin = createAdminClient();
    await admin.from("deletion_log").insert({
      user_id: user.id,
      platform_post_id: platformPostId,
      success: true,
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[delete] action failed:", auditSource, platformPostId, e);
    const status = e instanceof XApiError ? e.status : 500;
    const message = e instanceof Error ? e.message : "delete failed";

    // Log failure
    const admin = createAdminClient();
    await admin.from("deletion_log").insert({
      user_id: user.id,
      platform_post_id: platformPostId,
      success: false,
      error: message,
    });

    // Map X API errors to user-friendly messages
    if (e instanceof XApiError && e.status === 403) {
      return NextResponse.json(
        { success: false, error: "Your X account needs to be reconnected to enable deletion. Please sign in again." },
        { status: 403 },
      );
    }
    if (e instanceof XApiError && e.status === 429) {
      return NextResponse.json(
        { success: false, error: "X rate limit reached. Try again in ~15 minutes." },
        { status: 429 },
      );
    }
    if (e instanceof XApiError && e.status === 404) {
      if (auditSource === "own_text" || auditSource === "own_images") {
        // Tweet genuinely no longer exists — treat as success.
        return NextResponse.json({ success: true });
      }
      // For likes/reposts: 404 means "wasn't liked/reposted" — not a deletion.
      return NextResponse.json(
        { success: false, error: "not_found" },
        { status: 404 },
      );
    }

    return NextResponse.json(
      { success: false, error: message },
      { status: status >= 400 && status < 600 ? status : 500 },
    );
  }
}
