# Current State

- Production: `https://boutikier.dorveilsn.workers.dev`.
- Supabase production: project `boutikier`, ref `jkbxrsjdkgjbuxheustn`, Paris `eu-west-3`.
- Cloudflare: Worker `boutikier`; SPA, API and cron outbox share one deployment.
- Surfaces: boutique `/`, client `/client`, statement read-only `/s/:token`.
- Data: five migrations replayable; RLS, explicit grants, journal append-only, corrections compensatoires, disputes, FIFO, QR HMAC et liens privés.
- UI: données réelles via API; aucun mock n'entre dans le build de production.
- QR client: le même QR boutique fonctionne depuis la PWA ou la caméra normale; un visiteur passe par OTP, crée ou retrouve son compte client léger, revient au QR, confirme le solde projeté puis écrit avec la provenance `shop_qr`.
- Démonstration contrôlée: client `777629953` et boutique `703549365`, PIN visible `1234` mappé au test OTP `123456`; la production refuse les autres numéros et les OTP de test Supabase expirent le 5 septembre 2026.
- Security: audit complet; faiblesse QR faible corrigée par vérification HMAC avant RPC privilégié.
- Backups: commande `npm run backup:production`; sorties locales ignorées sous `.artifacts/backups/`.
- Deferred: fournisseur WhatsApp/SMS réel et Google OAuth, listés dans `BACKLOG.md`.
- Pending physical QA: parcours QR réel à valider avec l'iPhone côté client et le navigateur PC côté boutique après déploiement de la version.
- Operations: `docs/operations/production.md` est l'unique runbook de production.
