# Boutikier

Boutikier est un monorepo npm :

- `apps/prototype`: validated mobile interaction prototype and Sites runtime.
- `apps/web`: production React/Vite application.
- `apps/server`: Hono API for Cloudflare Workers, with a Node.js local adapter.
- `packages/contracts`: shared Zod boundary contracts.
- `supabase`: local configuration, migrations, and database tests.

Production : [boutikier.guydorveilmalonga.workers.dev](https://boutikier.guydorveilmalonga.workers.dev)

Utiliser Node.js 22 ou plus récent. La vérification reproductible est :

```powershell
npm ci
npm run build
npm test
npm run test:runtime
supabase test db
```

For local live development, start Supabase, then the Worker and web app:

```powershell
supabase start
npm run dev:server
npm run dev --workspace @boutikier/web -- --port 4174
```

Copy the documented local values into `apps/server/.dev.vars` and
`apps/web/.env.local`; the corresponding example files list every required key.

Lire `PRODUCT.md` pour le contrat produit, `DECISIONS.md` pour les décisions actives et
`STATE.md` pour l'état courant minimal. Le runbook de production est dans
`docs/operations/production.md`; les détails d'architecture restent sous `docs/architecture/`.
