# CLAUDE.md

dontcancel.me: scans a user's X (Twitter) timeline, flags risky posts by category,
links each for review, and supports deletion via the X API. Monorepo: **`web/`**
(Next.js app) + **`supabase/`** (DB/auth config + migrations). Human setup/env docs
live in `README.md` — don't duplicate them here.

## Commands

Run app commands from **`web/`**; Supabase from the **repo root**.

| Task | Command |
| --- | --- |
| Dev server | `pnpm dev` (in `web/`) — http://127.0.0.1:3000 |
| Typecheck | `pnpm typecheck` (in `web/`) |
| Lint | `pnpm lint` |
| Build | `pnpm build` |
| Test | `pnpm test` (vitest) |
| Local DB/auth | `supabase start` / `supabase status` (repo root) |

Use **pnpm**, never npm/yarn. Always run typecheck + lint + tests before declaring done.

## Conventions

- **Next.js 16** App Router + Turbopack, **React 19**, **Tailwind v4**, TS strict.
- Import alias **`@/*` → `web/src/*`**.
- Middleware is the Next 16 **`proxy`** convention: `web/src/proxy.ts` (refreshes the
  Supabase session every request + gates `/portal/*`). Its `matcher` must exclude all
  `_next/` (HMR websocket breaks otherwise).
- Server-only modules guard with `import "server-only"` (the pkg is a real dep).
- Error boundaries: `app/error.tsx` (route segments) and `app/global-error.tsx` (root
  layout) catch unhandled errors in production.

## Architecture map (`web/src`)

- `app/` — routes. `page.tsx` landing, `login/`, `start/` (audit intake + inline auth),
  `portal/` (auth-gated: `scans/`, `scans/[jobId]`, `scans/new`, `settings/`,
  `account/`).
- `app/api/` — `x/tweets` (ingest), `x/likes` + `x/likes/charge` (likes drain),
  `x/charge-deterministic` (upfront billing), `x/delete` (delete/unlike/unretweet),
  `moderation/check` (Phase-1 profanity gate), `quote/`, `stripe/checkout`,
  `stripe/topup`, `stripe/webhook`. All `export const runtime = "nodejs"`.
- `app/auth/callback/route.ts` — OAuth code exchange + captures X tokens.
- `lib/audit/` — `engine.ts` (orchestration: `runAudit` + `runLikesDrain`),
  `detectors.ts` (client-side regex: PII, credentials, doxxing, substances),
  `source.ts` (`fetchTweets`, `fetchLikesPage`, billing helpers), `storage.ts`
  (localStorage), `types.ts` (`RiskCategory` enum, `AuditedPost`, `AuditSource`, etc.),
  `severity.ts` (design-language severity mapping).
- `lib/audit/moderation/` — Phase-1 moderation pipeline:
  `gate.ts` (compiled Surge wordlist regex — lazy module singleton),
  `pipeline.ts` (`moderateBatch()` — orchestrates Phase-1 gate → labels),
  `taxonomy.ts` (Surge category → `ModerationLabel` mapping + severity buckets),
  `data/wordlist.json` (~120 KB compiled JSON, bundled at build),
  `data/profanity_en.csv` (source CSV).
- `lib/x/` — `api.ts` (X v2 client, hard timeouts, delete/unlike/unretweet functions),
  `oauth.ts` (token capture/refresh, encrypted in `connection_secrets`).
- `lib/supabase/` — `client.ts` (browser), `server.ts` (RSC/route), `admin.ts`
  (service_role, server-only).
- `lib/` — `crypto.ts` (AES-256-GCM token encryption), `billing.ts` (credit constants),
  `stripe.ts` (lazy Stripe client singleton).
- `components/` — `JobRunner.tsx` (client-side audit runner — the heart of the flow),
  `DeleteTweetButton.tsx` (trash icon → modal → X API delete), `QuoteView.tsx`,
  `TopUpButton.tsx`, `AuthPanel.tsx`, `JobCreationForm.tsx`, portal navigation,
  UI primitives (`RiskCard`, `Button`, `Badge`, `StatStrip`, etc.).

## How the audit works

`JobRunner` (client) loads job meta from `audit_jobs`, then **Phase A** (deterministic):
`chargeDeterministic()` (idempotent) → `fetchTweets()` → `detect()` per tweet → lazy
batch moderation via `POST /api/moderation/check` (chunks of 25). **Phase B** (likes
drain, metered): pages through liked tweets, charges per-item against balance, runs
detection + moderation. Results persist to **localStorage** (`audit:<jobId>`); the DB
holds job **metadata** (status/progress/stats) + credit ledgers. Tweets are **not**
stored server-side in v1.

**Detection pipeline per tweet (engine.ts):**
1. Client-side regex (`detectors.ts`): PII, credentials, doxxing, substances
2. Server-side moderation gate (if `nsfw`, `violence`, `hate_speech`, or `profanity`
   categories are enabled): `POST /api/moderation/check` → `ProfanityGate` scans text
   → `taxonomy.ts` maps Surge categories to `ModerationLabel`s
3. Merge: `flags = [...regexFlags, ...moderationFlags]`

**Each post tracks its `auditSource`** (`own_text`, `own_images`, `likes`, `reposts`)
so the delete flow can route to the correct X API endpoint.

**Live vs sample:** live path only for X-authenticated users
(`user.app_metadata.provider === "x"`); everyone else (incl. dev-login) gets sample data.

**Billing:** credit-based (1 credit = 1¢). `user_credits` table holds `free_used`
(lifetime, max 500) + `balance`. `charge_deterministic()` is idempotent (keyed on
`job_id`); `charge_like()` is per-item (deduped by cursor). Stripe checkout creates
inline `price_data` (1¢/unit × quantity) — no pre-configured price ID needed.
Webhook calls `apply_credit_purchase()` (idempotent, flips `pending` → `paid`).
Payment state written only via service_role security-definer SQL functions.

**Delete flow:** `DeleteTweetButton` → confirmation modal ("THIS WILL DELETE THIS TWEET.
NO UNDO.") → `POST /api/x/delete` → X API (deleteTweet / unlikeTweet / unretweet based
on `auditSource`) → log to `deletion_log` → remove from localStorage → post disappears
from view. No credits charged.

## Moderation pipeline (Phases 1 & 2 — built)

- **Surge wordlist regex gate** (`gate.ts`): 1,597 terms compiled to a single regex,
  longest-first alternation, digit-aware word boundaries. Supports leetspeak (`5h1t`,
  `@55`). Lazy module-scope singleton, compiled once per warm runtime.
- **Taxonomy** (`taxonomy.ts`): maps Surge categories → `{curse, strong_curse,
  nsfw_sexual, hate}`. No `violent` label from Phase 1 — Surge has no violence category.
- **Pipeline** (`pipeline.ts` + `phase2.ts`): `moderateBatch()` runs Phase 1 then
  Phase 2 (`phase2: true` from the route). Phase 2 calls OpenAI `omni-moderation-latest`
  and produces the `violent` label. `OPENAI_API_KEY` absent → fail-open (`skipped_no_key`).
  Phase 3 (label reconciliation) is not yet built.
- **Persistence**: `moderation_checks` table stores SHA-256 hash of text (never raw
  text), phase1 results, labels, severity, decision. Written via service_role, read via
  RLS (owner only).
- **Fail-open**: moderation API errors → empty results returned, audit continues with
  regex-only flags.

## Hard constraints — do not change without being asked

- **Detection is text-only.** Images are *displayed* on post cards when present
  (resolved via the X API `attachments.media_keys` expansion — no extra request).
  No image analysis occurs; `nsfw`, `violence`, and all other categories classify
  text only. Sample/dev-login data has no media.
- **Secrets server-only.** OAuth tokens live encrypted in `connection_secrets`
  (service_role only), never returned to the client. `SUPABASE_SERVICE_ROLE_KEY` and
  `APP_ENCRYPTION_KEY` must never be `NEXT_PUBLIC_`.
- **Dev login** stays env-gated (`NEXT_PUBLIC_ENABLE_DEV_LOGIN`), never in prod.
- `.env` (repo root) and `web/.env.local` are gitignored — verify nothing secret is
  staged before any commit.
- User commits **directly on `main`** this project. Only commit/push when asked.
- **No raw tweet text on server.** The `moderation_checks` table stores only SHA-256
  hashes + structured results, never raw text. LocalStorage holds results client-side.

## Traps (these have bitten us)

- **`127.0.0.1` ≠ `localhost`** for cookies — mixing them breaks the OAuth/PKCE flow.
  The auth callback derives origin from the **Host header**, not `new URL(request.url)`
  (Next dev normalizes it to localhost). Stay on `127.0.0.1`.
- **Stripe checkout origin trap:** `new URL(request.url).origin` in dev normalizes to
  `localhost` even when browser uses `127.0.0.1`. Session cookies won't be sent to
  the different origin → user returns from Stripe to find themselves logged out.
  The auth callback's Host-header pattern is the fix; if copying Stripe routes,
  replicate that pattern.
- **`JobRunner` has no abort-on-cleanup.** React StrictMode double-mounts the effect in
  dev; aborting in cleanup kills the real run. Don't reintroduce an AbortController there.
- **X refresh tokens rotate single-use:** calling the refresh endpoint invalidates the
  previous access token. Don't refresh casually while debugging — it logs the user out.
- **Local Supabase auto-grants** new public tables to `anon`/`authenticated`. New
  migrations must `revoke all ... from anon, authenticated` and grant explicitly.
- **Open redirect in auth callback:** the `next` query param in
  `auth/callback/route.ts` is validated to start with `/` — don't remove that check or
  accept arbitrary URLs.
