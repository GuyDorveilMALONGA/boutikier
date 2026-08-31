# Database Scope

- PostgreSQL/Supabase migrations are the authority for persisted behavior.
- Never update or delete ledger or dispute events; corrections are inverse entries linked to the original.
- Enforce tenant isolation with foreign keys and RLS, then test both owner access and cross-shop denial.
- Never authorize from `user_metadata`; use trusted identity ownership or `app_metadata` where necessary.
- Keep privileged functions out of exposed schemas when possible; revoke default `PUBLIC` execution.
- Public Data API access requires explicit grants and RLS. Do not assume new tables are exposed automatically.
- Create migrations with `supabase migration new`, then verify against local Postgres.
- Run database tests and advisors before treating a schema change as complete.
