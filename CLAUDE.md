# CLAUDE.md

Audit-X: scans a user's X (Twitter) timeline, flags risky posts by category, links
each for review. Monorepo: **`web/`** (Next.js app) + **`supabase/`** (DB/auth config +
migrations). Human setup/env docs live in `README.md` — don't duplicate them here.

## Commands

Run app commands from **`web/`**; Supabase from the **repo root**.

| Task | Command |
| --- | --- |
| Dev server | `pnpm dev` (in `web/`) — http://127.0.0.1:3000 |
| Typecheck | `node_modules/.bin/tsc --noEmit -p tsconfig.json` (no `typecheck` script) |
| Lint | `pnpm lint` |
| Build | `pnpm build` |
| Local DB/auth | `supabase start` / `supabase status` (repo root) |

Use **pnpm**, never npm/yarn. Always run typecheck + lint before declaring done.

## Conventions

- **Next.js 16** App Router + Turbopack, **React 19**, **Tailwind v4**, TS strict.
- Import alias **`@/*` → `web/src/*`**.
- Middleware is the Next 16 **`proxy`** convention: `web/src/proxy.ts` (refreshes the
  Supabase session every request + gates `/portal/*`). Its `matcher` must exclude all
  `_next/` (HMR websocket breaks otherwise).
- Server-only modules guard with `import "server-only"` (the pkg is a real dep).

## Architecture map (`web/src`)

- `app/` — routes. `page.tsx` landing, `login/`, `start/` (audit intake + inline auth),
  `portal/` (auth-gated: `jobs/`, `jobs/[jobId]`, `jobs/new`, `settings/`).
- `app/api/` — `x/tweets` (ingest + billing gate), `stripe/checkout`, `stripe/webhook`.
  All `export const runtime = "nodejs"`.
- `app/auth/callback/route.ts` — OAuth code exchange + captures X tokens.
- `lib/audit/` — `engine.ts` (orchestration), `detectors.ts` (regex flagging + redaction),
  `source.ts` (`fetchTweets`: live via API or `sampleTweets`), `storage.ts`
  (localStorage), `types.ts` (`RiskCategory` enum + `RISK_LABELS`).
- `lib/x/` — `api.ts` (X v2 client, hard timeouts), `oauth.ts` (token capture/refresh).
- `lib/supabase/` — `client.ts` (browser), `server.ts` (RSC/route), `admin.ts`
  (service_role, server-only).
- `lib/` — `crypto.ts` (AES-256-GCM token encryption), `billing.ts`, `stripe.ts`.
- `components/JobRunner.tsx` — client-side audit runner (the heart of the flow).

## How the audit works

`JobRunner` (client) loads job meta from `audit_jobs`, then `runAudit()` →
`fetchTweets()` → `detect()` per tweet → progress callbacks. Results persist to
**localStorage** (`audit:<jobId>`); the DB only holds job **metadata** (status/progress/
stats). Tweets are **not** stored server-side in v1.

**Live vs sample:** live path only for X-authenticated users
(`user.app_metadata.provider === "x"`); everyone else (incl. dev-login) gets sample data.

**Billing gate:** `GET /api/x/tweets?jobId=` computes `scanned = min(tweetCount, 3200)`;
free ≤ 500; else `ceil((scanned-500)/500)` blocks. If unpaid → **402** →
`PaymentRequiredError` → PaymentView → `POST /api/stripe/checkout` → Stripe → webhook
marks `audit_payments` paid. Gate is enforced **server-side**; payment state written only
via service_role.

## Hard constraints — do not change without being asked

- **No deletion.** The tool surfaces flagged posts only.
- **Text only** (no media/image handling) in v1.
- **Secrets server-only.** OAuth tokens live encrypted in `connection_secrets`
  (service_role only), never returned to the client. `SUPABASE_SERVICE_ROLE_KEY` and
  `APP_ENCRYPTION_KEY` must never be `NEXT_PUBLIC_`.
- **Dev login** stays env-gated (`NEXT_PUBLIC_ENABLE_DEV_LOGIN`), never in prod.
- `.env` (repo root) and `web/.env.local` are gitignored — verify nothing secret is
  staged before any commit.
- User commits **directly on `main`** this project. Only commit/push when asked.

## Traps (these have bitten us)

- **`127.0.0.1` ≠ `localhost`** for cookies — mixing them breaks the OAuth/PKCE flow.
  The auth callback derives origin from the **Host header**, not `new URL(request.url)`
  (Next dev normalizes it to localhost). Stay on `127.0.0.1`.
- **`JobRunner` has no abort-on-cleanup.** React StrictMode double-mounts the effect in
  dev; aborting in cleanup kills the real run. Don't reintroduce an AbortController there.
- **`STRIPE_PRICE_ID` must be a price (`price_…`), not a product (`prod_…`)** or checkout
  500s.
- **X refresh tokens rotate single-use:** calling the refresh endpoint invalidates the
  previous access token. Don't refresh casually while debugging — it logs the user out.
- **Local Supabase auto-grants** new public tables to `anon`/`authenticated`. New
  migrations must `revoke all ... from anon, authenticated` and grant explicitly.
