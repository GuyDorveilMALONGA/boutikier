# Current State

- Production: `https://boutikier.dorveilsn.workers.dev`.
- Supabase production: project `boutikier`, ref `jkbxrsjdkgjbuxheustn`, Paris `eu-west-3`.
- Cloudflare: Worker `boutikier`; SPA, API and cron outbox share one deployment.
- Surfaces: boutique `/`, client `/client`, statement read-only `/s/:token`.
- Data: five migrations replayable; RLS, explicit grants, journal append-only, corrections compensatoires, disputes, FIFO, QR HMAC et liens privés.
- UI: données réelles via API; aucun mock n'entre dans le build de production.
- Local demo only: client `777629953` et boutique `703549365`, PIN visible `1234` mappé au test OTP local.
- Security: audit complet; faiblesse QR faible corrigée par vérification HMAC avant RPC privilégié.
- Backups: commande `npm run backup:production`; sorties locales ignorées sous `.artifacts/backups/`.
- Deferred: fournisseur WhatsApp/SMS réel et Google OAuth, listés dans `BACKLOG.md`.
- Operations: `docs/operations/production.md` est l'unique runbook de production.
