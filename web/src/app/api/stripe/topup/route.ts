import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripe } from "@/lib/stripe";
import { STRIPE_MIN_UNITS } from "@/lib/billing";

export const runtime = "nodejs";

/**
 * Create a Stripe Checkout session to purchase scan credits. Credits are
 * user-level; the webhook (`apply_credit_purchase`) adds them to
 * `user_credits.balance` on payment confirmation.
 *
 * Rate: $0.01 per credit (1 US cent). Minimum purchase: MIN_CREDITS (500).
 *
 * `jobId` is optional — when provided, the success URL returns the user to that
 * job so a scan blocked by insufficient credits can resume immediately.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const credits = Number(body.credits);
  const jobId: string | undefined = body.jobId || undefined;

  if (!Number.isInteger(credits) || credits < STRIPE_MIN_UNITS) {
    return NextResponse.json(
      { error: `credits must be a whole number ≥ ${STRIPE_MIN_UNITS}` },
      { status: 400 },
    );
  }

  const origin = new URL(request.url).origin;
  const successUrl = jobId
    ? `${origin}/portal/jobs/${jobId}?topped_up=1`
    : `${origin}/portal/account?topped_up=1`;
  const cancelUrl = jobId
    ? `${origin}/portal/jobs/${jobId}`
    : `${origin}/portal/account`;

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          // 1 US cent per credit → 500 credits = $5.00
          unit_amount: 1,
          product_data: { name: "Scan Credits" },
        },
        quantity: credits,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      user_id: user.id,
      type: "topup",
      credits: String(credits),
      ...(jobId ? { job_id: jobId } : {}),
    },
  });

  // Record the pending purchase (service-role: table has no write policies).
  const admin = createAdminClient();
  await admin.from("credit_purchases").insert({
    user_id: user.id,
    credits,
    blocks: 0,
    status: "pending",
    stripe_session_id: session.id,
  });

  return NextResponse.json({ url: session.url });
}
