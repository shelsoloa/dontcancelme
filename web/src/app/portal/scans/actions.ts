"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function deleteJob(jobId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("audit_jobs")
    .update({ deleted_at: new Date().toISOString() })
    .eq("job_id", jobId);
  revalidatePath("/portal/scans");
}
