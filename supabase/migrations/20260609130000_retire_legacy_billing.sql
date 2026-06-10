-- Retire legacy billing artefacts.
--
-- audit_payments was the per-job pay-per-scan model, fully superseded by
-- user_credits / credit_purchases / charge_job_credits in 20260608160000.
-- No app code references it (only its own migration did).

drop table if exists public.audit_payments;
