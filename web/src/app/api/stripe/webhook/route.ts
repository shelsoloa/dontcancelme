import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Stripe webhook. Verifies the signature against the raw body, then credits
 * the user's scan-credit balance via `apply_credit_purchase` (idempotent —
 * a repeated event for the same session is a no-op).
 */
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }

  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret);
  } catch (e) {
    return NextResponse.json(
      { error: `invalid signature: ${String(e)}` },
      { status: 400 },
    );
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (
      session.payment_status === "paid" &&
      session.metadata?.type === "topup"
    ) {
      const admin = createAdminClient();
      await admin.rpc("apply_credit_purchase", {
        p_session_id: session.id,
        p_payment_intent:
          typeof session.payment_intent === "string"
            ? session.payment_intent
            : null,
      });
    }
  }

  return NextResponse.json({ received: true });
}
