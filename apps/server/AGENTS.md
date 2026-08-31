# Server Scope

- Production runtime: Cloudflare Workers with Hono and Workers Static Assets.
- Keep HTTP wiring in `src/app.ts`; `src/worker.ts` is the production adapter and
  `src/index.ts` remains a Node.js 22 compatibility adapter for local diagnostics.
- Add product behavior as vertical modules, not generic controller/service/repository layers.
- Validate every external boundary with schemas from `@boutikier/contracts`.
- Do not embed schema migrations or authorization policy in application code.
- Ledger, correction, dispute, claim, share, and outbox writes must use database functions and transactions.
- Private statement responses under `/s/*` must retain `Cache-Control: private, no-store`.
- Add or update a Node test for every route or middleware behavior change.
- User JWTs must be forwarded to Supabase RPC calls so RLS remains the authorization authority.
- Service keys are reserved for internal outbox/share/verification work and must never enter browser code.
- Verify with `npm run build --workspace @boutikier/server` and `npm run test --workspace @boutikier/server`.
