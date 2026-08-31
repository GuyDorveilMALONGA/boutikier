# Boutikier — Résumé final du produit

> **Le carnet de crédit partagé entre une boutique et ses clients.**
> **Le boutiquier suit son argent. Le client construit sa réputation.**

## 1. Vision

Boutikier remplace le cahier papier utilisé pour suivre les achats à crédit dans les petites boutiques.

Ce n’est pas une banque, un système d’autorisation de crédit ou un logiciel comptable complexe. L’accord et la remise des articles se font dans la vie réelle. L’application sert ensuite à :

- enregistrer l’opération ;
- informer immédiatement l’autre partie ;
- suivre les sommes dues et remboursées ;
- conserver un historique fiable ;
- corriger ou contester une opération ;
- mesurer la fiabilité de remboursement du client.

La relation est toujours entre **un client et un boutiquier**. Les employés ne font pas partie du produit.

## 2. Principe central

> **L’échange réel vaut accord. Boutikier l’enregistre et informe l’autre partie.**

Une opération enregistrée entre immédiatement dans le journal. Elle ne nécessite pas l’approbation numérique de l’autre partie.

Il n’existe donc pas de :

- demande en attente ;
- proposition à accepter ;
- validation obligatoire ;
- refus de crédit dans l’application.

L’autre partie reçoit une notification et peut consulter ou contester l’opération.

## 3. Enregistrer un achat à crédit

### Depuis l’application client

1. Le client choisit ou scanne la boutique.
2. Il saisit les articles et le montant.
3. Il consulte un récapitulatif.
4. Il touche **Enregistrer mon achat**.
5. La dette entre immédiatement dans le journal.
6. Le boutiquier reçoit une notification.

### Depuis l’application du boutiquier

1. Le boutiquier choisit ou scanne le client.
2. Il saisit les articles et le montant.
3. Il consulte un récapitulatif.
4. Il touche **Enregistrer la vente à crédit**.
5. La dette entre immédiatement dans le journal.
6. Le client reçoit une notification.

Le récapitulatif affiche toujours :

- la boutique ou le client concerné ;
- les articles ;
- le montant ;
- la date prévue de règlement, lorsqu’elle existe ;
- le nouveau solde ;
- la personne qui recevra la notification.

Une reconnaissance facultative peut être proposée, mais elle ne bloque jamais le solde.

## 4. Enregistrer un remboursement

Après la remise réelle de l’argent, le client ou le boutiquier peut enregistrer le remboursement.

L’opération :

- entre immédiatement dans le journal ;
- diminue le solde ;
- génère un reçu ;
- déclenche une notification à l’autre partie ;
- peut être contestée en cas d’erreur.

Les paiements partiels sont autorisés.

## 5. Application du boutiquier

Le premier écran contient :

- **Total à recevoir** ;
- **Total remboursé sur la période** ;
- **Crédit accordé sur la période** ;
- **Montant contesté** ;
- recherche client ;
- liste des clients ;
- opérations récentes.

Le boutiquier peut choisir la période :

> Aujourd’hui · 7 jours · Ce mois · Tout

Depuis une fiche client, il peut :

- voir le solde ;
- consulter l’indice de confiance du client ;
- enregistrer une vente à crédit ;
- enregistrer un remboursement ;
- consulter le journal ;
- corriger une écriture ;
- traiter une contestation ;
- partager un relevé privé.

Boutikier fournit un **suivi du crédit**, pas une comptabilité générale complète.

## 6. Application du client

Le client peut :

- voir ou masquer sa dette totale ;
- consulter ses soldes par boutique ;
- retrouver ses boutiques associées ;
- scanner une nouvelle boutique ;
- enregistrer un achat à crédit ;
- enregistrer un remboursement ;
- consulter son historique ;
- consulter son indice de confiance ;
- reconnaître ou contester une opération.

## 7. Indice de confiance du client

Seul le client possède un score. Le boutiquier n’en possède pas.

L’indice évolue selon :

- la rapidité des remboursements ;
- le respect de la date prévue ;
- la régularité des paiements ;
- les remboursements partiels ;
- les retards.

Les opérations contestées ne sont pas utilisées tant que la contestation n’est pas résolue.

Un nouveau client affiche **Nouveau — historique insuffisant** jusqu’à ce qu’il dispose de suffisamment de dettes réglées.

Exemple :

> **78/100 — Bon**
>
> 6 dettes réglées
> 5 réglées dans le délai prévu
> Temps moyen de règlement : 9 jours

Pour le MVP, le score reste lié à la relation entre le client et chaque boutique. Le client voit son score et ses explications ; le boutiquier le voit depuis la fiche client.

Le score ne bloque jamais automatiquement l’accès au crédit : la décision reste humaine.

## 8. Journal financier

Le journal est immuable et constitue la source de vérité.

Il contient :

- les dettes ;
- les remboursements ;
- les compensations.

Une opération n’est jamais modifiée ou supprimée.

Pour corriger 10 000 FCFA en 8 000 FCFA, Boutikier ajoute :

- une compensation de `−10 000 FCFA` ;
- une nouvelle écriture de `+8 000 FCFA`.

Le produit affiche séparément :

- le solde enregistré ;
- le montant contesté ;
- le montant non contesté.

Une contestation ne supprime pas l’opération et ne réécrit pas l’historique.

## 9. Surfaces du produit

- `/` : application du boutiquier ;
- `/client` : application authentifiée du client ;
- `/s/:token` : relevé privé partagé en lecture seule ;
- future route QR : résolution d’un code boutique ou client opaque.

Le boutiquier ne peut pas basculer directement vers l’espace privé du client.

## 10. QR, identité et WhatsApp

### QR de la boutique

Chaque boutique possède un QR permanent, imprimable et révocable.

Il contient uniquement un code opaque, jamais :

- un téléphone ;
- un solde ;
- un UUID interne ;
- une donnée financière.

Après le scan, le client voit le nom de la boutique et doit confirmer qu’il s’agit de la bonne boutique avant de saisir son achat.

### QR du client

Une version ultérieure permettra au client vérifié d’afficher un QR temporaire et révocable pour être retrouvé rapidement par le boutiquier.

### WhatsApp

WhatsApp sert à transporter :

- les notifications d’opération ;
- les reçus ;
- les liens de relevé ;
- les OTP.

Pour un numéro non vérifié, le message reste générique et n’expose ni montant, ni article, ni solde.

## 11. Sécurité et fiabilité

- Confirmation du serveur avant toute écriture.
- Brouillon local si la connexion tombe.
- Clés d’idempotence contre les doubles clics.
- Avertissement en cas de doublon probable entre les deux parties.
- Isolation des boutiques et clients par RLS.
- Outbox transactionnelle pour les notifications.
- Liens privés temporaires et révocables.
- QR résolus uniquement côté serveur.
- Pages financières en `private, no-store`.
- OTP WhatsApp avec SMS en secours.

## 12. Architecture technique

- **Frontend :** React + Vite, mobile-first ;
- **API :** Hono sur Cloudflare Workers ;
- **Hébergement :** Cloudflare ;
- **Données :** Supabase PostgreSQL ;
- **Sessions :** Supabase Auth ;
- **Photos :** Supabase Storage ;
- **OTP :** Twilio Verify ;
- **Contrats :** Zod ;
- **Tests :** Vitest et Playwright.

## 13. Hors périmètre MVP

- employés et permissions d’équipe ;
- score du boutiquier ;
- score client global partagé entre toutes les boutiques ;
- demandes de crédit à distance ;
- validation obligatoire de chaque opération ;
- catalogue complet de produits ;
- paiement Wave ou mobile money intégré ;
- comptabilité générale ;
- QR client permanent.

Ce résumé devient la base produit de référence pour rédiger le PRD, le modèle de données et les parcours écran par écran.
