import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { moderateBatch } from "@/lib/audit/moderation/pipeline";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const { jobId, items } = body as Record<string, unknown>;

  if (typeof jobId !== "string" || !jobId) {
    return NextResponse.json({ error: "missing jobId" }, { status: 400 });
  }
  if (!Array.isArray(items)) {
    return NextResponse.json(
      { error: "items must be an array" },
      { status: 400 },
    );
  }
  if (items.length > 50) {
    return NextResponse.json(
      { error: "batch cap is 50 items" },
      { status: 400 },
    );
  }

  // Validate each item.
  const sanitized: { id: string; text: string }[] = [];
  for (const item of items) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.id !== "string" ||
      typeof item.text !== "string"
    ) {
      return NextResponse.json(
        { error: "each item must have {id:string, text:string}" },
        { status: 400 },
      );
    }
    sanitized.push({ id: item.id, text: item.text });
  }

  // RLS-scoped ownership check — prevents writing checks for another user's job.
  const { data: job } = await supabase
    .from("audit_jobs")
    .select("job_id")
    .eq("job_id", jobId)
    .maybeSingle();
  if (!job) {
    return NextResponse.json({ error: "job not found" }, { status: 404 });
  }

  const results = await moderateBatch(sanitized, { phase2: true });

  // Persist via service-role client. Never store raw text — hash only.
  const admin = createAdminClient();
  const rows = sanitized.map((item, i) => {
    const result = results[i];
    const inputHash = createHash("sha256")
      .update(item.text.normalize("NFC"))
      .digest("hex");
    return {
      job_id: jobId,
      user_id: user.id,
      input_hash: inputHash,
      input_length: item.text.length,
      phase1: result.phase1,
      phase2: result.phase2,
      labels: result.labels,
      severity: result.severity,
      decision: result.decision,
      degraded: result.degraded,
    };
  });

  if (rows.length > 0) {
    const { error: insertError } = await admin
      .from("moderation_checks")
      .insert(rows);
    if (insertError) {
      console.error("moderation_checks insert failed:", insertError.message);
      // Fail-open: return results even if audit write failed.
    }
  }

  return NextResponse.json({ results });
}
