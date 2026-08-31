# Boutikier Agent Guide

## Purpose

Boutikier manages the relationship between one shop and its clients. There are no employees in the product model.
The shop interface is task-first for time-poor, non-technical users: open on the client carnet, expose actions where needed, and avoid decorative controls or navigation that requires exploration.

## Context Routing

- For mobile prototype work, read `apps/prototype/AGENTS.md`.
- For Node/Hono work, read `apps/server/AGENTS.md`.
- For database, Auth, RLS, migration, or financial-ledger work, read `supabase/AGENTS.md`.
- Read `DECISIONS.md` before changing product behavior, data ownership, public APIs, infrastructure, or security.
- Read `STATE.md` only for cross-cutting work or when continuing an unfinished task.
- Do not load every Markdown file by default. Search code and tests first.

## Sources Of Truth

- Executable constraints, tests, schemas, and types outrank prose.
- `DECISIONS.md` contains only decisions that are still active; Git contains their history.
- `STATE.md` is overwritten as the project changes. It is not a session log.
- A temporary `HANDOFF.md` may be created for a long interrupted task, then removed when absorbed.

## Work Rules

- Investigate, design, then implement. Preserve unrelated user changes.
- Fix the structure that permits a defect; do not accumulate behavioral patch instructions here.
- Put shared request/response validation in `packages/contracts`.
- Add server features as vertical modules under `apps/server/src/modules` only when the first real feature exists.
- Keep SQL changes in timestamped Supabase migrations and verify them against a real Postgres instance.
- Encode mandatory behavior in tests, constraints, CI, or scripts rather than relying on agent memory.

## Commands

- Install: `npm ci`
- Context gate: `npm run check:context`
- Full build: `npm run build`
- Fast tests: `npm test`
- Mobile runtime tests: `npm run test:runtime`
- Prototype: `npm run dev:prototype`
- Production web: `npm run dev:web`
- API: `npm run dev:server`

## Completion

Report every failed or skipped verification exactly. For changes spanning three or more files or any backend change, name residual risks.

## Durable Production UI Decisions

- The supplied green `B` mark with cream ledger shapes and orange pages is Boutikier's canonical logo. Use `/assets/brand-mark.png` in product headers and its generated PNG derivatives for browser and PWA icons; do not substitute a generic receipt icon for the brand.
- Local demo access uses client `777629953` and shop `703549365`, both with the visible PIN `1234`. The UI adapter exists only under Vite development and translates that PIN to Supabase's six-digit local test OTP; all sessions, RLS, relationships, and journal writes remain real.
- Authentication is full-page and photo-led. Signup is the default flow and collects the account role plus the person's or boutique's name before OTP; login stays a separate, lighter mode. OTP is primary, Google is secondary, and Google users must verify a phone before onboarding.
- First onboarding explicitly creates either a shop space or a client space; the two interfaces remain separate.
- Client amount visibility is global and persisted on the device. Hidden totals, breakdowns, relationship balances, recent activity, and journal amounts use asterisks.
- Client home shows at most three confirmed recent operations; `Mes relevés` owns the complete immutable history.
- A single relationship never renders a shop selector. Multiple relationships use one labeled menu.
- Operation forms switch debt and repayment in place, keep separate drafts, hide mobile root navigation while focused, and reset idempotency after every confirmed write.
