# Exploitation production

## Autorités

| Service | Ressource | Région / URL |
| --- | --- | --- |
| Supabase | `boutikier` (`jkbxrsjdkgjbuxheustn`) | Paris `eu-west-3` |
| Cloudflare | Worker `boutikier` | `https://boutikier.guydorveilmalonga.workers.dev` |
| Git | dépôt privé Boutikier | branche protégée par CI |

Le compte Cloudflare ne contient actuellement aucune zone DNS. Le sous-domaine `workers.dev`
est donc l'URL canonique jusqu'à l'ajout volontaire d'un domaine.

## Secrets

Les valeurs ne vivent que dans Cloudflare :

- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `APP_HMAC_SECRET`

Contrôle sans afficher les valeurs :

```powershell
npm exec wrangler secret list --workspace @boutikier/server
```

`apps/web/.env.production` ne contient que l'URL et la clé publiable Supabase. Les secrets
WhatsApp/SMS et Google ne sont pas configurés; voir `BACKLOG.md`.

## Déployer

```powershell
npm ci
npm run build
npm test
npm run test:runtime
npm run deploy --workspace @boutikier/server
```

Après chaque déploiement :

```powershell
Invoke-WebRequest https://boutikier.guydorveilmalonga.workers.dev/api/health
npm run load:smoke -- https://boutikier.guydorveilmalonga.workers.dev/api/health
```

Vérifier aussi `/`, `/client`, `/connexion`, les en-têtes CSP/HSTS et qu'un appel anonyme à
`/api/me` retourne `401`.

## Base de données

```powershell
supabase link --project-ref jkbxrsjdkgjbuxheustn
supabase migration list --linked
supabase db push --linked --include-all --dry-run
supabase db lint --linked --level warning
```

Ne jamais modifier une migration déjà appliquée. Ajouter une migration, la tester localement,
puis exécuter le `dry-run` avant le push.

## Sauvegardes

Le plan Supabase Free ne fournit pas de sauvegarde quotidienne gérée. Générer avant chaque
migration et au minimum chaque semaine :

```powershell
npm run backup:production
```

La commande produit `roles`, `schema` et `data` sous `.artifacts/backups/`. Ces fichiers sont
ignorés par Git et doivent être copiés vers un stockage chiffré hors du poste. Effectuer un
test de restauration sur un projet Supabase jetable avant l'ouverture à des données réelles,
puis chaque trimestre.

Référence : https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore

## Observabilité

- Cloudflare Observability est activée avec un échantillonnage de `1` pendant la phase MVP.
- Le cron outbox s'exécute toutes les deux minutes et reste inerte sans fournisseur configuré.
- Surveiller erreurs Worker, latence p95, réponses `5xx`, RPC Supabase et lignes `dead` de l'outbox.
- Le test de référence actuel est 200 requêtes concurrentes par lots de 10, sans échec.

## Retour arrière

1. Lister les versions : `npm exec wrangler versions list --workspace @boutikier/server`.
2. Revenir à la version saine avec `wrangler rollback` depuis `apps/server`.
3. Pour la base, ne jamais réécrire l'historique : appliquer une migration corrective.
4. En cas de perte de données, isoler le service et restaurer le dernier triplet
   `roles/schema/data` dans un projet Supabase propre avant de changer l'URL du Worker.

## Contrôles périodiques

- Hebdomadaire : santé, erreurs, outbox et sauvegarde hors site.
- Avant release : CI complète, lint DB, dry-run migrations, secrets listés, smoke et charge.
- Trimestriel : restauration, rotation `APP_HMAC_SECRET` planifiée et revue RLS/grants.
- Une rotation HMAC invalide les QR et liens actifs; elle doit être accompagnée d'une
  régénération des QR boutique.
