"use server";

import { createClient } from "@/lib/supabase/server";
import { RiskCategory } from "@/lib/audit/types";

type ProfileInput = {
  age: number;
  gender: string;
  race?: string;
  sexualOrientation?: string;
  country?: string;
};

export type StartAuditInput = {
  profile: ProfileInput;
  categories: RiskCategory[];
};

export type StartAuditResult = { jobId: string } | { error: string };

/**
 * Upserts the user's demographic profile and queues an audit job. RLS enforces
 * that both rows belong to the authenticated user.
 */
export async function startAudit(
  input: StartAuditInput,
): Promise<StartAuditResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in to start an audit." };

  const valid = new Set<string>(Object.values(RiskCategory));
  const categories = input.categories.filter((c) => valid.has(c));
  if (categories.length === 0) {
    return { error: "Select at least one category to audit." };
  }
  if (!input.profile.gender || !Number.isFinite(input.profile.age)) {
    return { error: "Age and gender are required." };
  }

  const { error: profileErr } = await supabase.from("profiles").upsert({
    user_id: user.id,
    age: input.profile.age,
    gender: input.profile.gender,
    race: input.profile.race || null,
    sexual_orientation: input.profile.sexualOrientation || null,
    country: input.profile.country || null,
  });
  if (profileErr) return { error: profileErr.message };

  // Link the user's X connection (if any) so the audit can ingest live tweets.
  const { data: connection } = await supabase
    .from("connections")
    .select("id")
    .eq("user_id", user.id)
    .eq("platform", "x")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: job, error: jobErr } = await supabase
    .from("audit_jobs")
    .insert({
      user_id: user.id,
      platform: "x",
      enabled_categories: categories,
      status: "queued",
      connection_id: connection?.id ?? null,
    })
    .select("job_id")
    .single();
  if (jobErr || !job) {
    return { error: jobErr?.message ?? "Could not create the audit job." };
  }

  return { jobId: job.job_id as string };
}
