import "server-only";
import Stripe from "stripe";

/**
 * Lazily-constructed Stripe client. Lazy so a missing key only errors when a
 * billing route is actually hit (the free audit path never imports Stripe).
 */
let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    client = new Stripe(key);
  }
  return client;
}
