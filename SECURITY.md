# Security

## Invariants

- Un JWT utilisateur est transmis aux RPC métier; le `service_role` reste dans les secrets Worker.
- Toute fonction `SECURITY DEFINER` publique vérifie `auth.uid()` ou reste accordée au seul `service_role`.
- Le journal, les contestations et les allocations sont immuables; une correction ajoute une compensation.
- Les QR et liens partagés sont opaques, signés, révocables et ne contiennent aucune donnée financière.
- Les réponses financières utilisent `private, no-store`.
- Aucun secret réel ne doit être commité, affiché dans un rapport ou placé dans une variable `VITE_*`.

## Review Scope

Prioriser l'authentification, l'isolation boutique/client, les grants/RLS, les RPC privilégiées,
les liens partagés, l'outbox, les sauvegardes et les changements de configuration Cloudflare/Supabase.
Les avertissements Supabase sur `SECURITY DEFINER` sont acceptables uniquement après validation
de l'autorisation interne et des grants explicites; ils ne doivent jamais être masqués par principe.

## Reporting

Ne jamais tester avec des données financières réelles. Documenter une reproduction minimale,
la frontière rompue, l'impact et la vérification du correctif.
