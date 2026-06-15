# Moderation pipeline — Phase 2 & 3 (OpenAI + reconciliation)

> **Phase 1 is built.** The Surge wordlist regex gate, taxonomy mapping, batch API route
> (`POST /api/moderation/check`), `moderation_checks` table, and engine integration are
> live. See `web/src/lib/audit/moderation/` for the code. This doc covers the remaining
> work: Phase 2 (OpenAI moderation) and Phase 3 (reconciliation).

Status: Phase 1 done. Phase 2+3 not yet built. Target: `dontcancel.me` monorepo (`web/`
Next.js 16 App Router + `supabase/`). Original plan written 2026-06-11; trimmed
2026-06-15.

---

## Current state (post Phase 1)

| What | Status |
|------|--------|
| Gate regex (`gate.ts`) — compiled Surge wordlist, module singleton | Built |
| Taxonomy (`taxonomy.ts`) — Surge category → label mapping | Built |
| Pipeline (`pipeline.ts`) — Phase 1 only, `phase2: false`, `phase2: null` | Built |
| API route (`POST /api/moderation/check`) — auth, batch ≤ 50, persist, respond | Built |
| `moderation_checks` table — stores hash, phase1, labels, severity, decision | Built |
| Engine integration — lazy batching in `runAudit` + `runLikesDrain` | Built |
| `phase2` column in `moderation_checks` — always `null` | Needs Phase 2 |
| `"violent"` ModerationLabel — declared but never produced | Needs Phase 2 |
| `detector: "llm"` — declared but never produced | Needs Phase 2 |
| OpenAI API key / client | Not yet |

---

## 1. Architecture (Phase 2 integration)

```
client (JobRunner / engine.ts)
  └─ POST /api/moderation/check   { jobId, items: [{ id, text }] }   (batch ≤ 50)
       ├─ Phase 1  in-process TS gate (built)
       ├─ Phase 2  OpenAI omni-moderation-latest, ONE batched call for phase-1-clean
       │           texts, hard timeout, fail-open-with-record
       ├─ Phase 3  reconcile Surge + provider categories → unified labels + overall
       │           severity
       └─ insert modulation_checks rows (service_role) → respond per-item decisions
```

### Phase-2 provider: OpenAI `omni-moderation-latest`, synchronous, batched

OpenAI moderation is **free**, requires one `OPENAI_API_KEY` env var, accepts an **array
of inputs** (one call per batch, not per tweet), and has 13 categories that map onto our
taxonomy.

- Client: hand-rolled `fetch` with a hard timeout, mirroring the repo's existing
  `lib/x/api.ts` pattern — **no OpenAI SDK dependency**.
- **Sync within the request**, because the caller is already an interactive per-batch
  loop with progress UI.
- **Latency budget** (route p95, batch of 50): Phase 1 ≤ 10 ms; Phase 2 batched call,
  2,500 ms hard timeout; Phase 3 + DB insert ≤ 100 ms. Whole route **p95 ≤ 3 s per
  batch**.

### Failure behavior: fail-open-with-record

Phase-2 failure (timeout/5xx/no key): fail open, record the degradation. The decision is
computed from Phase 1 alone, `phase2.status` is recorded as `timeout|error|skipped`, and
the row is marked `degraded = true` so degraded checks are queryable and re-runnable.
Absent `OPENAI_API_KEY` → `skipped_no_key`, pipeline still works (keeps local dev honest).

---

## 2. OpenAI omni-moderation categories → taxonomy

These are the labels Phase 2 will produce. The Surge half of the taxonomy (Phase 1
→ `{curse, strong_curse, nsfw_sexual, hate}`) is already built in `taxonomy.ts`.

| Provider category | Label | Note |
| --- | --- | --- |
| sexual | `nsfw_sexual` | |
| sexual/minors | `nsfw_sexual` | always overall severity `severe` |
| hate, hate/threatening | `hate` | hate/threatening also adds `violent` |
| violence, violence/graphic | `violent` | |
| harassment | `strong_curse` | insult-class |
| harassment/threatening | `violent` | |
| self-harm, self-harm/intent, self-harm/instructions | `violent` | imperfect fit — a dedicated `self_harm` label is **deferred** |
| illicit, illicit/violent | illicit/violent → `violent`; plain illicit → **unmapped** | raw category recorded in `phase2` jsonb; relates to `substances` RiskCategory — deferred |

### Overall severity + UI projection

- Overall severity = max across signals: Surge sev 1–<2 → `mild`, 2–<2.5 → `strong`,
  ≥2.5 → `severe`; provider scores ≥ 0.9 on any mapped category → at least `strong`;
  `sexual/minors` or `*/threatening` → `severe`.
- UI projection (so `Flag`/`RiskCategory`/`RISK_LABELS` stay untouched):
  `curse`/`strong_curse` → `profanity`, `nsfw_sexual` → `nsfw`, `violent` → `violence`,
  `hate` → `hate_speech`.

---

## 3. Implementation plan

### M2 — Phase 2: OpenAI moderation on phase-1-clean text

Files to create/modify:

- **`web/src/lib/moderation/provider.ts`** (new) — `fetch` client, array input, 2,500 ms
  hard timeout (pattern from `lib/x/api.ts`), typed category/score response.
- **`web/src/lib/moderation/pipeline.ts`** — phase-1-clean items go to one batched
  provider call; timeout/error/no-key ⇒ `degraded = true`, decision from Phase 1 alone.
- **`web/src/app/api/moderation/check/route.ts`** — passes the actual `OPENAI_API_KEY`
  config; no contract change (shape was final in M1).
- **`web/.env.example`** — add `OPENAI_API_KEY`. Vercel env set at deploy.
- **No new migration** — `moderation_checks.phase2` column already exists.

### M3 — Phase 3: reconciliation + final taxonomy

Files to modify:

- **`web/src/lib/moderation/taxonomy.ts`** — add the provider-categories half of §2 and
  the reconcile function: union of labels from both signals, overall severity per §2,
  `sexual/minors` and `*/threatening` overrides.
- **`web/src/lib/moderation/pipeline.ts`** — final `labels`/`severity` come from
  reconcile instead of Surge-only.
- **`web/src/lib/audit/engine.ts`** — surface fine-grained labels in `Flag.reason`
  (e.g. "Strong profanity (gate + model agree)").

---

## 4. Success metrics & feedback loop

- **Accuracy:** a labeled sample of ~200 texts (extend `lib/audit/sampleTweets` with
  hand-labeled positives/negatives per label, incl. edge cases and leetspeak). Script:
  `web/scripts/eval-moderation.ts` runs the pipeline offline and prints per-label
  precision/recall. Targets: Phase 1 precision ≥ 0.95 (deterministic gate — FPs are
  whitelist bugs); pipeline recall ≥ 0.85 per label on the sample.
- **Latency:** `phase1.ms` / `phase2.ms` in every audit row — p95 queryable from
  `moderation_checks` with plain SQL. Budgets: phase1 p95 ≤ 10 ms per batch; route p95
  ≤ 3 s per 50-item batch; `degraded` rate < 2% of phase-2-eligible rows.
- **Cost:** OpenAI moderation is $0; marginal cost is Vercel function time.
- **False-positive loop:** user marking a flagged post `keep` is an FP signal; `delete`
  confirms. Review = SQL over `moderation_checks` joined on job, plus the gate's
  **whitelist** (checked-in list in `gate.ts` config).

---

## 5. Out of scope / deferred (explicit)

- **Image moderation** — CLAUDE.md hard constraint: detection is text-only. Not touched.
- **Perspective API / GCP moderateText** — Perspective sunsets 2026-12-31; GCP adds
  infra for no merit.
- **Queue/async/batch-job infra** — banned by the no-worker constraint.
- **Edge Config / Supabase-hosted wordlist** — list changes ride deploys for now.
- **`input_hash` dedupe cache** (skip Phase 2 on repeated text) — index already in place.
- **`self_harm` and `illicit/substances` taxonomy labels** — raw signals recorded in
  `phase2` jsonb, adding labels later is a mapping change, not a backfill.
- **Multilingual** — Surge list is English-only; omni-moderation is multilingual, but
  Phase 1 silently passes non-English text.
- **CI** — repo has none; vitest is CI-ready when it arrives.
- **Migrating PII/credentials/doxxing/substances detection server-side** — works fine
  client-side today.
