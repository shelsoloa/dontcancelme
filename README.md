# Audit-X

A social media audit tool. It scans a user's **X (Twitter)** timeline, flags potentially sensitive or risky posts across a set of risk categories, and presents the results with a link back to each post so the user can review them in context.

Detected categories:
- personally identifiable information (PII)
- doxxing of others
- credentials & secrets
- NSFW/sexual content
- violence & threats
- hate speech & harassment
- profanity
- drugs & alcohol.

**Status / scope of v1**

- **Text only** — no media/image handling.
- **Read-only** — the audit surfaces flagged posts for review; it does **not** delete anything.
- **Sources:** each audit can scan the user's own **posts**, **liked posts**, and **reposts** — selected per audit on the intake form.
- Tweet ingestion and detection currently run **client-side** (tweets are not persisted server-side yet).
- **Billing:** the first 500 scannable tweets are free. Accounts whose selected sources exceed 500 tweets pay per 500-tweet block via a one-time Stripe Checkout before the scan runs.

### X API cost

This app reads **only the authenticated user's own resources** — their timeline (`GET /2/users/{id}/tweets`, which covers own posts *and* reposts) and their likes (`GET /2/users/{id}/liked_tweets`). Under X's pay-per-use model (default since **Feb 6, 2026**), and the pricing update effective **April 20, 2026**, both of these are **"Owned Reads" billed at $0.001 per resource** ($1 per 1,000). The higher **$0.005/resource** "standard read" rate applies only to reading *other* users' posts via lookup/search endpoints, which this app never calls. Usage is capped at ~2M reads/month, with a 24-hour UTC deduplication window (re-reading the same resource within a day is charged once).

Sources: [X API pricing](https://docs.x.com/x-api/getting-started/pricing) · [Owned Reads now $0.001, effective April 20, 2026](https://devcommunity.x.com/t/x-api-pricing-update-owned-reads-now-0-001-other-changes-effective-april-20-2026/263025).

## Tech stack

- **[Next.js](https://nextjs.org) 16** (App Router) + **React 19** + **Tailwind CSS v4**, TypeScript, managed with **pnpm**. Lives in [`web/`](web).
- **[Supabase](https://supabase.com)** — Postgres + Auth (Sign in with X via OAuth 2.0). Config and migrations live in [`supabase/`](supabase).
- **[Stripe](https://stripe.com)** — pay-per-scan billing (one-time Checkout + signed webhook).

## Prerequisites

- **Node.js 20+** and **[pnpm](https://pnpm.io)**
- **[Supabase CLI](https://supabase.com/docs/guides/cli)** and **Docker** (the local Supabase stack runs in Docker)
- **[Stripe CLI](https://docs.stripe.com/stripe-cli)** (to forward webhooks locally)
- An **X developer app** (OAuth 2.0, *confidential* client) and a **Stripe account** (test mode is fine for development)

## Getting started

### 1. Install dependencies

```bash
cd web
pnpm install
```

### 2. Start Supabase (Postgres + Auth)

From the repo root:

```bash
supabase start   # boots the local stack in Docker and applies all migrations
supabase status  # prints local URLs + API keys (you'll need these for step 4)
```

Local services (defaults from [`supabase/config.toml`](supabase/config.toml)):

| Service        | URL                       |
| -------------- | ------------------------- |
| API            | http://127.0.0.1:54321    |
| Database       | postgres://…@127.0.0.1:54322 |
| Studio (UI)    | http://127.0.0.1:54323    |
| Inbucket (mail)| http://127.0.0.1:54324    |

Sign in with X is enabled in `config.toml` and reads the X app credentials from the **repo-root `.env`** at `supabase start`. Create it with:

```env
# .env (repo root) — read by the local Supabase stack
SUPABASE_AUTH_EXTERNAL_X_CLIENT_ID=your-x-client-id
SUPABASE_AUTH_EXTERNAL_X_SECRET=your-x-client-secret
```

Register this callback URL in the X developer portal (OAuth 2.0): `http://127.0.0.1:54321/auth/v1/callback`. Requested scopes are `users.read tweet.read offline.access`.

### 3. Set up Stripe (billing)

Create a **one-time price** in the Stripe dashboard (Test mode → Product catalog). One unit = one 500-tweet block; the app sets the quantity. Copy its `price_…` id for `STRIPE_PRICE_ID`.

Forward webhooks to the app while developing — this prints the `whsec_…` signing secret used for `STRIPE_WEBHOOK_SECRET`:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

### 4. Configure the web app environment

Copy the template and fill in the values (see [Environment variables](#environment-variables)):

```bash
cd web
cp .env.example .env.local
```

### 5. Run the app

```bash
cd web
pnpm dev
```

Open **http://127.0.0.1:3000**. Use `127.0.0.1` (not `localhost`) consistently — they are different cookie origins, and mixing them breaks the OAuth/PKCE login flow locally. `config.toml` is set to `127.0.0.1`.

> **Local email login:** with `NEXT_PUBLIC_ENABLE_DEV_LOGIN=true` the login page also offers a dev email/password sign-in so you can test the portal without X. Dev-login accounts get **sample data** (only real X-authenticated users scan a live timeline). Never enable this in production.

## Environment variables

All app variables live in **`web/.env.local`** (gitignored). See
[`web/.env.example`](web/.env.example) for the template. Anything prefixed
`NEXT_PUBLIC_` is sent to the browser; everything else is **server-only** — never
add `NEXT_PUBLIC_` to a secret.

| Variable | Where to get it (test) | Where to get it (production) |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `supabase status` → *API URL* (`http://127.0.0.1:54321`) | Supabase dashboard → Project Settings → API → *Project URL* |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `supabase status` → *anon key* | Supabase dashboard → Project Settings → API → *anon / publishable key* |
| `NEXT_PUBLIC_ENABLE_DEV_LOGIN` | `true` (local email login) | unset / `false` |
| `SUPABASE_SERVICE_ROLE_KEY` | `supabase status` → *service_role key* | Supabase dashboard → Project Settings → API → *service_role / secret key* |
| `APP_ENCRYPTION_KEY` | generate: `openssl rand -base64 32` (32 bytes, base64) | same — generate once per environment and store in a secret manager |
| `X_CLIENT_ID` | X developer portal → your app → *OAuth 2.0 Client ID* | same (use the production app / callback URLs) |
| `X_CLIENT_SECRET` | X developer portal → your app → *Client Secret* | same |
| `STRIPE_SECRET_KEY` | Stripe dashboard (Test) → Developers → API keys → `sk_test_…` | Stripe dashboard (Live) → `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | `stripe listen` output → `whsec_…` | Stripe dashboard → Developers → Webhooks → your endpoint → *Signing secret* |
| `STRIPE_PRICE_ID` | Stripe dashboard → Product catalog → your price → `price_…` | same (live-mode price) |

> **`STRIPE_PRICE_ID` must be a price id (`price_…`), not a product id (`prod_…`).** Checkout uses it as a line-item price; a product id will fail.

> **`APP_ENCRYPTION_KEY`** encrypts the stored X OAuth tokens. Keep it stable for a given environment — rotating it makes existing stored tokens undecryptable (users must re-authenticate).

In addition, the **repo-root `.env`** (also gitignored) holds the X provider credentials for the local Supabase stack — `SUPABASE_AUTH_EXTERNAL_X_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_X_SECRET` (see step 2).

### Production notes

- **Supabase:** create a hosted project, push the schema with `supabase db push`, and configure the X provider under **Authentication → Providers → Twitter (X)** in the dashboard (instead of `config.toml` + root `.env`). Register `https://<your-ref>.supabase.co/auth/v1/callback` as the X OAuth callback.
- **Secrets** (`SUPABASE_SERVICE_ROLE_KEY`, `APP_ENCRYPTION_KEY`, `X_CLIENT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`) belong in your host's secret manager — never commit them.
- Switch Stripe to **live** keys/price and point a real webhook endpoint at `https://<your-domain>/api/stripe/webhook`.

## Project layout

```
web/         Next.js app (UI, API routes, audit engine, Supabase/Stripe clients)
supabase/    config.toml + SQL migrations for the database & auth
.env         (gitignored) X provider creds for the local Supabase stack
web/.env.local  (gitignored) app environment variables
```
