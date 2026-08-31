# Active Decisions

| ID | Decision | Reason |
| --- | --- | --- |
| D001 | React + Vite SPA, without SSR | The authenticated product does not require search indexing. |
| D002 | Hono runs on Cloudflare Workers | Use one edge-compatible HTTP runtime for the API and scheduled outbox work. |
| D003 | Cloudflare serves the React SPA and `/api/*` | Keep one deployment surface for the MVP. |
| D004 | Supabase is reached from Workers over its HTTP APIs | Preserve RLS and avoid opening a direct Postgres connection from every Worker invocation. |
| D005 | Supabase provides Postgres, Auth, and Storage | Mature transactions and managed identity/data services. |
| D006 | The financial journal and disputes are append-only event streams | History must remain auditable; corrections compensate earlier entries. |
| D007 | Recorded, disputed, and clear balances remain distinct | A dispute must not rewrite the recorded debt. |
| D008 | A client belongs to a shop until the phone is verified by OTP | Avoid merging identities based on unverified numbers. |
| D009 | WhatsApp statements are private, read-only, and never cacheable | Shared financial information must not leak through intermediary caches. |
| D010 | Twilio handles verification; an outbox handles messages | External delivery failures must not lose confirmed business events. |
| D011 | Shared API contracts use Zod | Frontend and backend validate the same boundary shapes. |
| D012 | Git is the archive; agent context files contain only active truth | Historical prose must not consume every session's context. |
| D013 | The production UI follows the supplied carnet prototype flows and mockup hierarchy | Preserve the validated product journeys while keeping the implementation React-native and API-ready. |
| D014 | The boutique app and shared statement are separate surfaces: `/` and `/s/:token` | A shop user must never switch into or inspect a client's private screen from the shop interface. |
| D015 | A claimed client uses an authenticated app at `/client`; `/s/:token` stays read-only | Account actions, validation, disputes, and credit requests must never be exposed through a shared statement link. |
| D016 | A real-world credit exchange is recorded immediately after server confirmation | The physical exchange is the agreement; digital counterparty approval is optional and never blocks the balance. |
| D017 | The shop app is task-first with a compact accounting summary and one visible entry point per command | Time-poor, non-technical shopkeepers must see essential figures and actions directly without duplicated commands or navigation to explore. |
| D018 | Both parties record free-form articles and an amount directly into the journal | There is no synchronized catalog and either participant may document the real-world exchange. |
| D019 | Only clients have a relationship-specific trust score | The score explains repayment behavior but never grants or refuses credit automatically. |
| D020 | Both parties may record debts and repayments | Each confirmed write updates the journal immediately and notifies the counterparty. |
| D021 | Shop QR codes are permanent and revocable; client QR codes are temporary and post-MVP | QR identifies a counterparty but never contains financial data or authorizes an operation. |
| D022 | Repayments are allocated FIFO through immutable allocation events | The rule is deterministic, needs no extra input, and can be reversed without rewriting history. |
| D023 | Trust score v1 stays `new` until three eligible debts are settled | The score is client-only, relationship-scoped, explainable, and advisory; its weights may be versioned later. |
| D024 | Probable duplicates return `409` before insertion and may be explicitly overridden | Idempotency handles retries; this second guard handles the same exchange entered by both parties. |
| D025 | The shop app has three roots: `Carnet`, `Activité`, and `Compte` | Mobile uses a bottom bar; desktop uses header navigation. Child screens have one contextual back action, and focused forms hide root navigation. |
| D026 | Permanent shop QR values are HMAC-signed and only their SHA-256 hash is stored | A QR can be reproduced from its opaque ID without persisting a reusable raw credential or exposing an internal UUID alone. |
| D027 | The production web app is installable as a PWA, but financial API responses are never cached | Static shell assets may work offline while balances and journals always come from an authenticated, current server response. |
| D028 | A visitor entering through a shop QR creates or restores a lightweight Supabase Auth client through phone OTP, then records only after an explicit financial preview | Anonymous journal writes remain forbidden; the verified client is accountable and shop approval does not block a confirmed real-world exchange. |

When a decision changes, replace its active row in the same change. Do not append obsolete decisions here.
