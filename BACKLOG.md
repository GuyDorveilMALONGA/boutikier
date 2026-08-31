# Backlog

## Intégrations différées

- WhatsApp/SMS réel : configurer le fournisseur, le numéro expéditeur, les modèles approuvés, les limites anti-abus/CAPTCHA et la vérification de livraison de bout en bout.
- Google OAuth : créer les identifiants Google, configurer le fournisseur Supabase et valider les redirections de production.

Ces deux intégrations ne bloquent pas la publication du coeur applicatif. Aucun envoi simulé ne doit être exposé en production tant que le fournisseur correspondant n'est pas configuré.
