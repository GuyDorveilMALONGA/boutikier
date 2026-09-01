# PRD — Refonte PWA client et boutiquier

**Statut :** prêt pour validation produit  
**Date :** 31 août 2026  
**Périmètre :** application de production `apps/web`, API Worker, contrats partagés et fonctions Supabase strictement nécessaires  
**Références visuelles :** Wave, `boutikier-premium (1).html` et captures fournies par le produit

## 1. Résumé

Cette évolution doit rendre Boutikier plus proche d'une application mobile native, plus calme visuellement et utilisable sans rechargement manuel.

Le client obtient un accueil sans barre d'onglets inférieure, organisé autour de son solde, de trois actions immédiates — **Acheter**, **Scanner**, **Rembourser** — puis de ses relations et de son activité récente.

Le boutiquier conserve exactement trois espaces racine — **Carnet**, **Activité**, **Compte** — mais leur responsabilité est clarifiée :

- **Carnet** : montant global à recevoir, QR permanent de la boutique et clients qui doivent ;
- **Activité** : petite comptabilité, journal global et indicateurs de confiance ;
- **Compte** : identité, sécurité et paramètres.

Le QR d'une nouvelle boutique doit être créé automatiquement, associé à la boutique réellement créée et visible immédiatement. Un scan, une nouvelle relation ou une opération confirmée depuis l'iPhone doit apparaître automatiquement sur l'écran du boutiquier, sans actualisation de page.

## 2. Problème à résoudre

### Symptômes observés

- L'accueil client est visuellement dispersé : le scan paraît trop haut, le menu trop bas et les blocs ne forment pas une hiérarchie cohérente.
- Le header produit une impression de double bande verte et ne respecte pas suffisamment la safe area iOS.
- La barre d'onglets client occupe de l'espace et donne à des actions simples le poids d'espaces racine.
- Certains écrans sont pilotés par un état React local au lieu d'une vraie route ; le retour navigateur et le geste iOS ne suivent donc pas toujours le parcours attendu.
- Le QR d'une boutique nouvellement créée peut demander un rechargement avant d'apparaître.
- Le navigateur du boutiquier ne voit pas automatiquement une relation ou une opération créée sur l'iPhone.
- La comptabilité détaillée surcharge le Carnet alors qu'elle appartient à l'Activité.

### Causes structurelles

- L'interface client mélange navigation racine, actions métier et écrans focalisés dans un composant monolithique.
- L'état distant repose principalement sur l'invalidation locale de TanStack Query ; une mutation effectuée sur un autre appareil ne peut pas invalider le cache du boutiquier.
- La création du compte boutique et la création du QR sont deux actions séparées, ce qui autorise un état boutique valide sans QR actif.
- Les responsabilités des trois espaces du boutiquier ne sont pas assez strictement séparées.

## 3. Objectifs produit

1. Faire comprendre l'état financier et l'action principale d'un écran en moins de trois secondes.
2. Permettre à un client d'acheter, scanner ou déclarer un remboursement en un geste depuis l'accueil.
3. Permettre un retour fiable sur tous les écrans focalisés avec une flèche et, lorsque Safari/PWA le permet, le geste natif depuis le bord gauche.
4. Garantir qu'une boutique nouvellement créée dispose immédiatement de son QR permanent.
5. Faire apparaître les changements distants côté boutiquier en **cinq secondes maximum** lorsque l'application est visible et connectée.
6. Préserver l'intégrité existante : journal immuable, aperçu avant confirmation, idempotence, contestations, corrections compensatoires, provenance et isolation inter-boutiques.
7. Valider le parcours réel avec l'iPhone client et le navigateur PC boutiquier sur le lien Cloudflare de production.

## 4. Non-objectifs

- Aucun vrai fournisseur OTP, SMS ou WhatsApp dans cette livraison ; les deux numéros de test et le PIN local convenus restent le moyen de validation.
- Aucun paiement ou transfert d'argent.
- Aucun QR client ou QR par opération.
- Aucun formulaire financier anonyme.
- Aucune approbation obligatoire du boutiquier avant inscription dans le journal.
- Aucun nouvel algorithme de score ni décision automatique d'octroi de crédit.
- Aucun geste de retour JavaScript personnalisé qui concurrencerait les gestes Safari/iOS.
- Aucun changement de framework, de bibliothèque d'icônes ou de modèle financier.

## 5. Principes d'expérience

### Direction visuelle

- Fond gris chaud très clair, presque plat ; aucun dégradé décoratif perceptible.
- Cartes blanches ou blanc cassé, détachées du fond par une bordure fine et une ombre très légère.
- Typographie simple, compacte et lisible. Inter reste la police principale ; les titres doivent être moins massifs qu'actuellement.
- Peu de texte, des libellés directs et des icônes déjà présentes dans le produit.
- Espacement généreux en haut, inspiré de Wave, mais densité utile dans le reste de la page.
- Le grand vide de l'état « aucune boutique » est volontaire. Seule la hiérarchie autour de ce vide doit être corrigée.
- Pas de glassmorphism, halos, illustrations décoratives, gros dégradés, ombres lourdes ou imitation visuelle exacte de Wave.

### Safe areas et chrome PWA

- Toute page racine utilise `env(safe-area-inset-top)` et `env(safe-area-inset-bottom)`.
- Une seule surface visuelle occupe le haut de l'écran ; aucune double bande verte.
- Le mot « Boutikier » n'est pas répété dans le header de l'application.
- L'engrenage des paramètres est placé en haut à gauche sur l'accueil client.
- Les écrans secondaires affichent une flèche retour à gauche et un titre centré.

### États obligatoires

Chaque écran concerné doit définir et tester : chargement, vide, succès, erreur récupérable, hors ligne et mutation en cours. Une action ne doit jamais disparaître sans indiquer comment revenir ou continuer.

## 6. Architecture d'information cible

### 6.1 Client

#### Accueil `/client`

Ordre vertical :

1. respiration supérieure et engrenage Paramètres ;
2. carte du montant total dû avec masquage global persistant ;
3. trois actions minimales : **Acheter**, **Scanner**, **Rembourser** ;
4. relations actives avec les boutiques ;
5. trois opérations confirmées maximum et lien **Voir tout**.

Règles :

- **Scanner** est l'action centrale, légèrement plus mise en avant, sans devenir une grande bannière.
- **Acheter** et **Rembourser** ouvrent un formulaire avec la seule boutique quand il n'existe qu'une relation.
- Avec plusieurs boutiques, l'utilisateur choisit la boutique dans un menu explicitement nommé.
- Sans boutique, Acheter et Rembourser affichent une explication courte et proposent d'ouvrir le scanner ; ils ne créent pas d'impasse.
- L'identité du client, son téléphone et la déconnexion n'occupent pas l'accueil.

#### Routes secondaires

| Route cible | Responsabilité |
|---|---|
| `/client/scanner` | caméra réelle et saisie de secours du lien/code |
| `/client/acheter` | choix de relation si nécessaire puis dette |
| `/client/rembourser` | choix de relation si nécessaire puis remboursement |
| `/client/releves` | historique complet, toutes boutiques |
| `/client/boutiques/:shopClientId` | relevé d'une relation et contestations |
| `/client/parametres` | identité, confidentialité des montants, sécurité, déconnexion |
| `/q/s/:code` | résolution et confirmation d'un QR boutique |

Les formulaires sont des routes focalisées. La navigation racine n'est donc pas masquée par une variable locale : elle n'existe tout simplement pas sur ces routes.

### 6.2 Boutiquier

#### Carnet `/`

- respiration supérieure ;
- montant global à recevoir avec montant contesté accessible sans surcharger la carte principale ;
- QR permanent centré et immédiatement scannable ;
- nom courant de la boutique sous le QR ;
- liste des clients ayant un solde, triée selon la règle existante ;
- accès au relevé individuel, à l'ajout de dette, au remboursement et au partage depuis le contexte du client.

Le Carnet ne contient plus la grille complète « remboursé / crédit accordé / contesté / périodes ».

#### Activité `/activite`

- résumé comptable compact avec périodes : à recevoir, remboursé, crédit accordé, contesté ;
- journal chronologique de toutes les écritures ;
- score de confiance relationnel existant visible pour chaque client lorsque pertinent ;
- statut **Nouveau** tant que trois dettes éligibles ne sont pas réglées ;
- explication accessible du score, qui reste consultatif et ne décide jamais du crédit.

#### Compte `/compte`

- nom de la boutique et téléphone ;
- modification de l'identité ;
- sécurité et déconnexion ;
- gestion secondaire du QR : renouveler/révoquer avec avertissement, sans répéter l'affichage principal du QR.

#### Navigation

- exactement trois onglets : Carnet, Activité, Compte ;
- barre inférieure sur mobile, au-dessus de la safe area ;
- navigation de header sur écran large ;
- routes enfants sans barre racine, avec flèche retour et titre centré.

## 7. Décisions techniques

### 7.1 Navigation client

**Option A — conserver les onglets dans l'état local et simuler le retour.** Plus rapide, mais le geste iOS, les liens profonds et la restauration d'écran restent fragiles.

**Option B — donner une URL réelle à chaque écran focalisé.** Un peu plus de refactorisation, mais l'historique navigateur devient la source de vérité et Safari/PWA peut fournir son geste de retour natif.

**Décision proposée : option B.** Aucun intercepteur de geste maison. La flèche appelle l'historique quand il existe et revient vers l'accueil dans le cas d'une entrée directe.

### 7.2 Création du QR après onboarding boutique

**Option A — lancer un second appel depuis le navigateur après l'onboarding.** Simple, mais une interruption peut laisser une boutique sans QR et plusieurs appels concurrents peuvent provoquer des rotations involontaires.

**Option B — garantir un QR actif dans la commande serveur d'onboarding.** Le serveur crée le QR s'il manque, reste idempotent en cas de répétition et renvoie un contexte exploitable immédiatement.

**Décision proposée : option B.** La création du QR devient un invariant d'une boutique active. Le renouvellement manuel reste une commande séparée et explicite.

### 7.3 Actualisation entre l'iPhone et le PC

**Option A — Supabase Realtime.** Latence minimale, mais ajoute publication, politique d'abonnement, gestion de reconnexion et couplage direct supplémentaire entre le navigateur et les tables financières.

**Option B — actualisation adaptative via l'API existante.** Les requêtes visibles sont relancées périodiquement, au retour au premier plan et après chaque mutation locale. La sécurité et la validation restent dans l'API Worker ; la latence est bornée mais non instantanée.

**Décision proposée pour ce MVP : option B.** Intervalle cible de 3 secondes sur les données visibles du boutiquier, arrêt en arrière-plan, reprise immédiate sur `visibilitychange`, focus et reconnexion. Si les mesures montrent un coût ou une latence insatisfaisante, Realtime fera l'objet d'une décision ultérieure séparée.

### 7.4 Score de confiance

**Option A — créer un nouveau score pour l'écran Activité.** Cela dupliquerait la logique, demanderait une nouvelle calibration et pourrait produire deux vérités.

**Option B — réutiliser le score relationnel déjà calculé.** Le contrat de liste/activité est étendu seulement si nécessaire pour transporter le résultat existant.

**Décision proposée : option B.** Aucun changement des pondérations ni du seuil de trois dettes réglées. Le score reste explicable, relationnel et consultatif.

Cette visibilité demandée côté boutiquier modifie le libellé actuel de D019/D023, qui qualifie encore le score de « client-only ». La validation du présent PRD vaut validation de la révision suivante : **le score appartient toujours au client dans le contexte d'une relation précise, mais il est visible par ce client et par le boutiquier propriétaire de cette relation**. Il n'est visible par aucune autre boutique et ne devient jamais un moteur de décision automatique.

## 8. Plan d'implémentation par slices

Chaque slice est intégrable, démontrable et testable indépendamment. Une slice n'est terminée que si ses critères d'acceptation et sa vérification passent.

### Slice 0 — Baseline, contrats UX et découpage du frontend

**But :** sécuriser la refonte avant de changer l'apparence.

**Travail :**

- capturer les parcours actuels client et boutiquier en viewport iPhone et desktop ;
- ajouter les routes cibles sans changer encore le contenu métier ;
- extraire progressivement le monolithe `App.tsx` en composants par surface client, boutique et composants partagés ;
- créer les tokens de couleur, espacement, rayon, bordure, ombre et typographie ;
- documenter les nouveaux invariants dans `DECISIONS.md` : navigation client sans barre racine, QR garanti après onboarding, fraîcheur distante bornée ;
- réviser D019/D023 pour autoriser au boutiquier propriétaire de la relation la lecture du score de son client, sans élargir l'accès inter-boutiques ;
- conserver les requêtes, mutations et règles métier existantes pendant l'extraction.

**Critères d'acceptation :**

- toutes les routes existantes continuent de fonctionner ;
- aucun changement de solde, journal, provenance ou autorisation ;
- les routes secondaires peuvent être ouvertes directement puis revenir à une destination sûre ;
- aucun fichier monolithique supplémentaire n'est créé.

**Vérification :** build contrats/web, tests E2E actuels, captures visuelles de référence.

### Slice 1 — Shell PWA et navigation native cohérente

**But :** corriger le chrome commun avant les écrans.

**Travail :**

- implémenter un shell mobile unique respectant les safe areas iOS ;
- supprimer le double vert et le libellé « Boutikier » du header produit ;
- créer le header secondaire avec chevron gauche et titre centré ;
- supprimer entièrement la barre d'onglets du client ;
- conserver et repositionner la barre trois onglets du boutiquier ;
- assurer des cibles tactiles d'au moins 44 × 44 px, un focus visible et des libellés accessibles.

**Critères d'acceptation :**

- aucun contenu ni bouton n'entre en conflit avec l'encoche ou l'indicateur d'accueil ;
- retour par flèche fonctionnel depuis chaque route secondaire ;
- le geste natif iOS fonctionne lorsque le contexte navigateur l'autorise ;
- aucune navigation ne disparaît à cause d'un simple état vide.

**Vérification :** Playwright mobile/desktop, navigation directe par URL, test manuel PWA iOS.

### Slice 2 — Nouvel accueil client

**But :** livrer la hiérarchie visuelle et les actions validées.

**Travail :**

- construire la carte de solde et son masquage persistant ;
- placer les trois actions Acheter, Scanner, Rembourser ;
- rendre Scanner central et légèrement prioritaire ;
- afficher les relations actives puis trois opérations confirmées maximum ;
- ajouter Voir tout vers les relevés ;
- concevoir l'état aucune boutique avec son espace volontaire ;
- déplacer le compte vers l'engrenage supérieur gauche.

**Critères d'acceptation :**

- les trois actions sont visibles sans ambiguïté sur l'iPhone cible ;
- une relation unique ne déclenche pas de sélecteur inutile ;
- plusieurs relations déclenchent un choix explicite ;
- sans relation, Acheter et Rembourser conduisent vers le scanner avec une explication ;
- les montants masqués le restent dans toutes les cartes, relations et opérations.

**Vérification :** tests E2E pour zéro, une et plusieurs boutiques ; snapshots/captures en montants visibles et masqués ; audit visuel sur les références.

### Slice 3 — Parcours client focalisés

**But :** rendre Acheter, Rembourser, Scanner, Relevés et Paramètres fiables comme des écrans natifs.

**Travail :**

- migrer les formulaires dette/remboursement vers leurs routes ;
- conserver les brouillons séparés et réinitialiser l'idempotence après écriture confirmée ;
- conserver l'aperçu solde avant/après et la détection de doublon ;
- créer le relevé global et la route d'une relation ;
- déplacer identité, téléphone, visibilité des montants et déconnexion dans Paramètres ;
- préserver caméra réelle, permission, saisie de secours et retour vers le QR après authentification.

**Critères d'acceptation :**

- recharger ou rouvrir une route focalisée ne casse pas le parcours ;
- retour depuis un formulaire ne confirme aucune écriture et conserve le bon brouillon ;
- une confirmation réussie revient à l'écran attendu et affiche l'opération ;
- la provenance `shop_qr` reste visible dans les deux audiences ;
- un refus de caméra offre une alternative exploitable.

**Vérification :** E2E scanner intégré, QR caméra normale avec et sans session, dette, remboursement, doublon, contestation et retour navigateur.

### Slice 4 — QR garanti et Carnet boutiquier recentré

**But :** rendre la nouvelle boutique immédiatement opérationnelle et le Carnet centré sur son usage quotidien.

**Travail :**

- rendre la commande d'onboarding boutique idempotente et garante d'un QR actif ;
- renvoyer ou précharger le QR après création sans GET en erreur ni bouton de génération initiale ;
- afficher dans le Carnet le montant global, le QR centré, le nom courant et les clients débiteurs ;
- déplacer les contrôles de rotation/révocation dans Compte avec confirmation ;
- faire en sorte qu'un changement de nom soit reflété sous le même QR sans rotation ;
- préserver le QR signé HMAC, son hash stocké et sa révocabilité.

**Critères d'acceptation :**

- après création avec le numéro boutique de test et un nom libre, le Carnet affiche ce nom et un QR scannable sans rechargement ;
- répéter l'onboarding ne crée pas plusieurs QR actifs et ne fait pas tourner le QR existant ;
- scanner le QR résout le nom actuel de la boutique ;
- le QR ne contient aucune donnée financière ;
- le Carnet ne montre plus la comptabilité de période complète.

**Vérification :** tests serveur de création/répétition/rotation, tests PostgreSQL d'isolation, E2E onboarding → QR → résolution.

### Slice 5 — Activité boutiquier et confiance client

**But :** regrouper les informations de pilotage sans alourdir le Carnet.

**Travail :**

- déplacer le résumé comptable et le filtre de période dans Activité ;
- conserver le journal global avec provenance et accès au client ;
- exposer le score relationnel existant dans la réponse appropriée sans nouvelle formule ;
- afficher Nouveau, Fiable, Régulier ou À surveiller avec les données explicatives autorisées ;
- afficher les montants contestés distinctement sans modifier leur traitement financier.

**Critères d'acceptation :**

- les valeurs du résumé restent identiques à celles calculées avant le déplacement ;
- un client avec moins de trois dettes réglées reste Nouveau ;
- le score n'est ni un bouton d'autorisation ni une recommandation automatique ;
- une écriture ouvre le bon relevé client ;
- le Carnet et Activité n'affichent pas deux résumés concurrents.

**Vérification :** tests de contrat/API, tests SQL du score existant, E2E périodes, provenance et navigation vers le relevé.

### Slice 6 — Synchronisation automatique multi-appareil

**But :** supprimer le besoin de recharger la PWA.

**Travail :**

- ajouter un intervalle adaptatif aux requêtes visibles `shop-clients`, `shop-summary`, `shop-activity` et au relevé sélectionné ;
- arrêter les relances quand l'onglet est caché ou hors ligne ;
- relancer immédiatement au focus, au retour en ligne et au changement de visibilité ;
- invalider et mettre à jour le cache après chaque mutation locale client ou boutique ;
- signaler discrètement un état hors ligne ou une erreur de synchronisation sans afficher des données comme confirmées à tort ;
- empêcher le service worker de mettre en cache les réponses financières.

**Critères d'acceptation :**

- scan client sur iPhone → relation visible sur PC en cinq secondes maximum sans rechargement ;
- opération confirmée sur iPhone → journal et résumé du PC mis à jour en cinq secondes maximum ;
- création/renouvellement QR → écran courant mis à jour immédiatement ;
- aucune requête financière périodique en arrière-plan ;
- aucune réponse financière servie depuis le cache PWA.

**Vérification :** test E2E à deux contextes navigateur, tests de visibilité/focus/reconnexion, inspection réseau et test du service worker.

### Slice 7 — Finition, accessibilité et test physique de production

**But :** démontrer le parcours réel complet et fermer les risques UX.

**Travail :**

- vérifier les contrastes, tailles tactiles, clavier, lecteurs d'écran et réduction des animations ;
- vérifier les états longs : noms, montants, listes et erreurs réseau ;
- vérifier les performances du scanner et des actualisations sur réseau mobile ;
- renouveler de manière contrôlée la configuration des OTP de test si elle est arrivée à expiration, sans activer un fournisseur OTP réel ;
- déployer selon la chaîne Git/Cloudflare du projet après validation des slices ;
- exécuter le scénario physique avec iPhone client et navigateur PC boutiquier.

**Scénario E2E physique final :**

1. supprimer les comptes de test précédents selon la procédure de données contrôlée ;
2. créer la boutique avec `703549365`, PIN `1234` et un nom choisi pendant le test ;
3. vérifier que le QR portant ce nom apparaît sans rechargement ;
4. installer/ouvrir la PWA sur l'iPhone et créer le client avec `777629953`, PIN `1234` et un nom choisi pendant le test ;
5. scanner le QR réel depuis l'iPhone ;
6. vérifier que le compte boutique et son nom sont présentés ;
7. confirmer la relation et vérifier son apparition automatique sur le PC ;
8. saisir un achat, vérifier le solde avant/après et confirmer ;
9. vérifier l'opération, sa provenance et le nouveau résumé sur le PC sans rechargement ;
10. saisir un remboursement et refaire les vérifications ;
11. tester retour par flèche, retour iOS, masquage des montants et réouverture de la PWA.

**Critères d'acceptation :**

- tout le scénario passe sur l'URL Cloudflare de production ;
- aucune étape ne demande une actualisation manuelle ;
- les noms saisis pendant le test apparaissent partout où attendu ;
- aucun ancien client ou ancienne boutique préchargé n'apparaît ;
- les erreurs ou vérifications non exécutées sont consignées exactement.

**Vérification :** build complet, suite complète, test physique documenté avec captures client et boutiquier.

## 9. Ordre et dépendances

```text
Slice 0 — fondations
   └─ Slice 1 — shell/navigation
        ├─ Slice 2 — accueil client
        │    └─ Slice 3 — parcours client
        └─ Slice 4 — QR + Carnet boutique
             └─ Slice 5 — Activité + score

Slices 3, 4 et 5
   └─ Slice 6 — synchronisation multi-appareil
        └─ Slice 7 — QA et production
```

Les Slices 2 et 4 peuvent être développées en parallèle après le shell, mais elles ne doivent pas être promues séparément en production si leurs contrats de navigation ou de données divergent.

## 10. Contrats et données susceptibles d'évoluer

- Le contrat de réponse d'onboarding boutique peut inclure ou précharger le QR actif, ou l'API peut garantir qu'un GET immédiat réussit. Le choix exact doit conserver l'idempotence.
- Les résumés de clients ou éléments d'activité peuvent recevoir le score relationnel déjà calculé ; aucune nouvelle table de score n'est prévue.
- Aucune migration de journal financier n'est prévue. Si l'invariant QR exige une fonction SQL supplémentaire, elle doit être transactionnelle, privée par défaut et couverte par RLS/tests.
- Les réponses financières gardent `Cache-Control: no-store` et ne sont jamais ajoutées au cache applicatif persistant.

## 11. Mesures de réussite

- 100 % des nouvelles boutiques de test ont un QR visible sans rechargement.
- 100 % des scans valides affichent le nom courant de la boutique.
- Délai P95 entre une écriture client confirmée et son affichage sur le PC : ≤ 5 secondes lorsque les deux applications sont visibles et en ligne.
- Zéro navigation client racine en bas de l'écran.
- Trois actions et seulement trois sur l'accueil client : Acheter, Scanner, Rembourser.
- Trois onglets et seulement trois côté boutiquier : Carnet, Activité, Compte.
- Zéro régression sur l'isolation, l'idempotence, les soldes, les contestations et la provenance.

## 12. Risques résiduels

- Le geste retour dépend du support réel de Safari/PWA et ne peut pas être garanti par l'application ; la flèche reste la garantie fonctionnelle.
- Le polling adaptatif n'est pas instantané et augmente les appels API quand l'application est visible. Les mesures de charge doivent confirmer l'intervalle de trois secondes.
- Une perte réseau juste après confirmation peut retarder l'affichage distant ; l'écriture serveur confirmée reste l'autorité.
- Le test OTP mocké valide le parcours fonctionnel mais pas la délivrabilité réelle SMS/WhatsApp, le CAPTCHA ou les limites fournisseur.
- Les OTP Supabase des deux numéros de test sont annoncés comme expirant le 5 septembre 2026. Après cette date, ils doivent être renouvelés avant le test physique ; le simple affichage du PIN `1234` ne prouve pas que la vérification distante fonctionnera.
- La suppression préalable des comptes de test est une opération destructive séparée ; elle doit viser uniquement les deux identités convenues et être sauvegardée/vérifiée avant exécution.

## 13. Definition of Done globale

- toutes les slices acceptées et leurs vérifications exécutées avec sorties conservées ;
- `npm run check:context`, `npm run build`, `npm test` réussis ;
- tests PostgreSQL, serveur, contrats et navigateur réussis ;
- captures iPhone et desktop comparées à la direction validée ;
- test E2E physique iPhone/PC réussi sur le lien Cloudflare ;
- aucune réponse financière mise en cache ;
- documentation `DECISIONS.md`, `STATE.md` et backlog mise à jour selon le résultat réel ;
- risques non testés ou échecs rapportés sans les masquer.
