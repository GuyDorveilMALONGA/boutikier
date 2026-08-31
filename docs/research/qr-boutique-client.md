# QR boutique-client : recherche et proposition

> Statut : archive de recherche, remplacée par `PRODUCT.md` et `DECISIONS.md`
> Date de vérification : 30 août 2026
> Portée : utilisateurs Boutikier déjà inscrits avec une identité vérifiée

Cette archive conserve la comparaison avec Wave. Ses anciens flux de demande et
d'approbation ne sont plus des décisions produit et ne doivent pas guider l'implémentation.

## Résumé exécutif

Wave ne repose pas sur un seul parcours QR. Son système couvre le paiement en personne dans les deux directions, les cartes QR destinées aux clients, les QR physiques de marchands, les liens distants, la résolution de l'identité du destinataire, les sessions de paiement et la réconciliation.

Pour Boutikier, le QR ne doit ni authentifier le client, ni créer une dette à lui seul. L'identité du client est déjà vérifiée. La décision active retient le QR pour identifier la contrepartie; l'échange réel vaut accord et l'écriture rejoint le journal après confirmation du serveur, sans approbation numérique bloquante.

La cible complète peut reprendre trois entrées inspirées de Wave :

1. le client scanne le QR de la boutique ;
2. le boutiquier scanne le QR temporaire du client ;
3. la boutique ou le client ouvre le même contexte via un lien WhatsApp.

Ces entrées doivent converger vers le même modèle de relation, de demande et d'approbation.

## Ce que Wave fait réellement

### 1. Deux directions de scan

Les conditions officielles Wave indiquent qu'un paiement marchand peut être réalisé soit par le scan du QR du marchand par le client, soit par le scan du QR de l'utilisateur par le marchand.

Wave Business met particulièrement en avant le second parcours : le marchand saisit ou connaît le montant, puis scanne la carte QR du client pour accepter un paiement en personne. Cette approche inclut aussi les clients qui utilisent une carte QR plutôt qu'un smartphone.

Conséquence pour Boutikier : un système inspiré de Wave ne doit pas supposer que le client est toujours celui qui tient la caméra.

### 2. QR marchand physique et durable

La documentation B2B Wave décrit des QR physiques présents dans les boutiques. Le code marchand est attribué au cas par cas et n'est jamais réattribué. Après décodage, le serveur peut retourner :

- le nom enregistré du marchand ;
- un identifiant marchand opaque ;
- un numéro de compte marchand formaté.

Le QR ne suffit donc pas comme vérité d'affichage. Il est résolu côté serveur afin d'obtenir l'identité actuelle et l'état actif du marchand.

Conséquence pour Boutikier : le QR imprimé contient un code public opaque et révocable. L'application doit récupérer le nom et l'état de la boutique depuis le serveur avant toute demande.

### 3. Carte QR du client

Les conditions Wave définissent aussi une carte QR permettant notamment aux utilisateurs sans smartphone d'accéder à leur compte dans un point de vente ou de payer un marchand équipé d'un smartphone.

Conséquence pour Boutikier : si un QR client est ajouté, il doit être considéré comme plus sensible qu'un QR boutique. Pour un client utilisant déjà l'application, un QR temporaire et à usage limité est préférable à une carte permanente.

### 4. Liens et paiements à distance

Wave Business permet au marchand d'envoyer un lien au client pour collecter un paiement à distance. Le lien et le QR physique sont donc deux transports différents vers un contexte marchand.

Conséquence pour Boutikier : le scan et le lien WhatsApp doivent ouvrir la même route de résolution de boutique. Ils ne doivent pas créer deux modèles fonctionnels différents.

### 5. Sessions dynamiques

La Checkout API Wave crée des sessions séparées comportant notamment :

- un montant ;
- une devise ;
- un nom commercial affiché au client ;
- un statut de session et de paiement ;
- une référence de corrélation ;
- une URL de lancement Wave ;
- une date d'expiration, de 30 minutes par défaut ;
- éventuellement une restriction au numéro du payeur.

Conséquence pour Boutikier : une demande de crédit est un objet propre avec son identifiant, son initiateur, son montant, son statut, ses dates et son historique. Elle ne doit jamais être stockée dans un emplacement unique sur le compte client.

### 6. Confirmation et réconciliation

Wave Business rassemble paiements physiques, paiements en ligne et reçus dans une même application. Les API exposent des identifiants et des statuts permettant la réconciliation.

Conséquence pour Boutikier : l'acceptation doit produire une transition atomique et traçable. Le serveur crée l'écriture de dette et relie cette écriture à la demande acceptée dans la même transaction.

## Comparaison avec les applications UPI en Inde

Le parcours UPI observé dans Paytm, Google Pay et les consignes NPCI suit généralement :

1. ouverture du scanner dans l'application ;
2. scan du QR marchand ;
3. affichage et vérification du nom du marchand ;
4. saisie ou vérification du montant ;
5. récapitulatif ;
6. autorisation ;
7. écran de succès et historique.

Le point le plus transférable à Boutikier est la confirmation visible de la contrepartie avant l'action. Des retours utilisateurs UPI montrent que le mauvais destinataire reste un risque réel lorsque le nom affiché n'est pas vérifié.

## Proposition Boutikier

### Principe central

Le QR sélectionne une contrepartie. Il n'authentifie personne et ne crée aucun engagement financier.

### Parcours A : le client scanne la boutique

1. Le client vérifié touche `Scanner une boutique`.
2. La caméra est chargée uniquement pour cet écran.
3. Le QR fournit un code boutique opaque.
4. Le serveur résout le code et renvoie le nom, l'identité visuelle et l'état de la boutique.
5. L'écran demande au client de confirmer la bonne boutique.
6. Le client saisit l'article et le prix.
7. Un récapitulatif affiche boutique, article et prix.
8. La demande est créée avec le statut `pending_shop`.
9. Le boutiquier accepte ou refuse.
10. L'acceptation crée la relation si nécessaire puis l'écriture de dette, atomiquement.

Après la première relation acceptée, la boutique apparaît dans `Mes boutiques`. Les demandes suivantes ne nécessitent plus de scan.

### Parcours B : le boutiquier scanne le client

1. Le client ouvre `Mon QR` dans son application.
2. L'application génère un QR temporaire et à usage limité.
3. Le boutiquier choisit `Scanner un client`.
4. Le serveur résout le QR vers l'identité vérifiée du client.
5. Le boutiquier confirme le nom et saisit l'article et le prix.
6. La proposition est créée avec le statut `pending_client`.
7. Le client valide ou conteste.
8. La validation crée la dette atomiquement.

Ce parcours est utile lorsque le boutiquier conduit la vente et évite de dicter un numéro de téléphone.

### Parcours C : lien WhatsApp

1. Un lien contient le même code boutique opaque que le QR imprimé.
2. Le client ouvre le lien depuis WhatsApp.
3. S'il possède une session Boutikier, la boutique est résolue immédiatement.
4. Sinon, il se connecte par OTP puis revient au même contexte.
5. Le reste du parcours est identique au parcours A.

## Écrans nécessaires

### Application client

- `Scanner une boutique`
- permission caméra avec explication courte
- boutique reconnue ou QR invalide
- confirmation de la boutique
- formulaire article et prix
- récapitulatif avant envoi
- liste de demandes indépendantes
- `Nouvelle demande`
- `Mes boutiques`
- `Mon QR` temporaire

### Application boutiquier

- QR permanent de la boutique, imprimable et partageable
- `Scanner un client`
- client reconnu ou QR expiré
- formulaire article et prix
- demandes reçues
- propositions envoyées
- acceptation, refus et historique

## Modèle de données proposé

Ce modèle n'est pas encore une décision de schéma.

### `shop_public_codes`

- `id`
- `shop_id`
- `code_hash`
- `status`
- `created_at`
- `revoked_at`

Un code boutique est durable et révocable. Il n'est jamais réattribué à une autre boutique.

### `client_qr_sessions`

- `id`
- `client_identity_id`
- `token_hash`
- `expires_at`
- `used_at`
- `revoked_at`

Une session QR client est courte, révocable et idéalement utilisable une seule fois.

### `credit_requests`

- `id`
- `shop_id`
- `client_identity_id`
- `shop_client_id`, nullable avant association
- `initiated_by`, `client` ou `shop`
- `article`
- `amount_xof`
- `status`
- `created_at`
- `decided_at`
- `ledger_entry_id`, rempli seulement après acceptation
- `idempotency_key`

### `credit_request_events`

- `id`
- `credit_request_id`
- `event_type`
- `actor_auth_user_id`
- `note`
- `recorded_at`

Les transitions restent auditables : création, acceptation, refus, annulation et expiration.

## Règles de sécurité

- Ne jamais mettre un UUID interne, un numéro de téléphone, un solde ou une identité personnelle en clair dans un QR.
- Résoudre tout QR côté serveur.
- Afficher le nom de la contrepartie avant la saisie et encore dans le récapitulatif.
- Ne jamais créer de dette au scan.
- Exiger l'approbation de l'autre partie.
- Protéger chaque mutation par authentification, RLS et clé d'idempotence.
- Limiter la fréquence des scans et des demandes.
- Permettre de révoquer un QR boutique compromis.
- Faire expirer rapidement un QR client.
- Conserver les transitions de demande sans suppression de l'historique.

## Coût pour la PWA

Le scan intégré reste faisable sans coût permanent :

- caméra ouverte uniquement après une action explicite ;
- décodeur chargé à la demande ;
- traitement des images sur le téléphone ;
- aucun flux vidéo envoyé ou stocké ;
- arrêt des pistes caméra immédiatement après détection ;
- fallback par appareil photo natif, lien WhatsApp ou saisie du code boutique.

`getUserMedia()` est largement disponible mais exige HTTPS et la permission de l'utilisateur. `BarcodeDetector` reste partiellement compatible ; un décodeur de secours doit donc être chargé seulement sur l'écran scanner.

## Alternatives

### Option 1 : client scanne boutique uniquement

Avantages : MVP plus petit, QR imprimable, parcours proche d'UPI.

Limites : le boutiquier ne peut pas initier rapidement une proposition en scannant le client.

### Option 2 : scans bidirectionnels et lien distant

Avantages : modèle le plus proche de Wave, couvre qui tient la caméra et les ventes à distance.

Limites : deux politiques de QR, plus d'états et davantage de tests de sécurité.

### Option 3 : aucun scanner intégré

Avantages : aucune permission caméra dans la PWA, développement minimal.

Limites : expérience moins directe pour un utilisateur déjà dans Boutikier.

## Recommandation par étapes

### MVP

- QR boutique permanent et révocable
- client vérifié scanne la boutique
- lien WhatsApp ouvrant le même contexte
- confirmation explicite de la boutique
- demandes multiples
- acceptation par le boutiquier avant dette
- mémorisation dans `Mes boutiques`

### Étape suivante

- QR client temporaire
- scan du client par le boutiquier
- propositions initiées par la boutique
- validation par le client

Cette séquence conserve une architecture compatible avec le modèle Wave complet sans imposer toute sa complexité au premier lancement.

## Sources

### Wave, sources officielles

- [Conditions Wave Cadeaux](https://www.wave.com/fr/terms_rewards_path_ci/) : confirme les deux directions de scan lors d'un paiement marchand.
- [Conditions générales Wave](https://www-preview.wave.com/fr/terms_gn/) : décrit la carte QR et son usage par les clients sans smartphone.
- [Wave Business sur Google Play](https://play.google.com/store/apps/details?id=com.wave.business) : scan des cartes QR clients, liens distants et reçus.
- [Wave Business](https://www.wave.com/fr/business-app/) : paiements physiques et réseau de marchands.
- [Wave B2B Recipient Info API](https://docs.wave.com/b2b/recipient-info/index.html) : résolution des QR physiques et liens marchands vers une identité commerciale.
- [Wave Checkout API](https://docs.wave.com/checkout) : sessions, montants, statuts, identité commerciale, expiration, restriction du payeur et URL de lancement.

### Comparaisons et Web

- [NPCI, UPI FAQ](https://www.npci.org.in/what-we-do/upi/faqs) : informations marchandes contenues dans les QR UPI.
- [Paytm, Scan & Pay](https://paytm.com/blog/paytm-help/how-to-scan-a-qr-code-pay-at-shops/) : confirmation du marchand, montant, autorisation et reçu.
- [Google Pay for Business](https://support.google.com/pay-offline-merchants/answer/9232302?hl=en-GB) : QR marchand personnalisé, partageable et imprimable.
- [MDN, getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) : disponibilité et contraintes de l'accès caméra.
- [MDN, BarcodeDetector](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector) : compatibilité partielle du décodage natif.

## Qualité et limites des preuves

Les capacités Wave, les types de QR et les primitives serveur sont bien documentés par des sources officielles. En revanche, Wave ne publie pas un guide exhaustif de chaque écran client et marchand. L'ordre précis de certains gestes d'interface est donc déduit des descriptions officielles, des captures de boutiques d'applications et des contrats API. Ces inférences ne doivent pas être présentées comme une reproduction exacte de l'application Wave.
