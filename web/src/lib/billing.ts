/**
 * Scan-credit pricing. Pure — safe to import on the server or client.
 *
 * Model: 1 credit = 1 US cent. Pricing by tweet type:
 *   text post / repost = 1 credit  ($0.01)
 *   image post         = 4 credits ($0.04, mirrors IMAGE_TWEET_WEIGHT)
 *
 * Free allowance: each user gets FREE_TWEET_LIMIT posts at no cost (lifetime,
 * user-level, applied to the cheapest (text) bucket first). Beyond that they
 * purchase credits. The SQL function charge_deterministic mirrors these constants.
 */

/** Lifetime free-post allowance per user. Mirrors v_free_limit in charge_deterministic. */
export const FREE_TWEET_LIMIT = 500;

/** Credits per US dollar (rate: $0.01 / credit). */
export const CREDITS_PER_DOLLAR = 100;

/**
 * Minimum Stripe charge in credits (~50 US cents).
 * Stripe enforces a $0.50 minimum; below this the session creation fails.
 */
export const STRIPE_MIN_UNITS = 50;
