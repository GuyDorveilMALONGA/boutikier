# Backlog

## QR boutique — MVP à compléter

### Décisions de cadrage

- Conserver un seul QR boutique permanent, révocable et réutilisable pour tous les clients. Le QR reste signé par le serveur, ne contient aucune donnée métier et ne sert qu'à identifier la boutique.
- Utiliser la même URL QR depuis la caméra normale du téléphone et depuis le scanner intégré à Boutikier. La route détecte ensuite la présence d'une session client.
- Ne pas créer de QR client, de QR propre à une opération, de paiement ou de mécanisme d'association supplémentaire dans ce MVP.
- Ne jamais autoriser un formulaire réellement anonyme à écrire dans le journal financier.
- Pour un visiteur sans compte préalable, exiger la vérification du téléphone par OTP. Cette vérification crée une vraie session et un compte client léger Supabase Auth ; l'interface doit l'annoncer clairement au lieu de prétendre qu'aucun compte technique n'est créé.
- Ne pas créer de seconde identité vérifiée avec `auth_user_id = null` et ne pas introduire un système d'authentification parallèle. Les fiches `shop_clients` restent locales et non réclamées ; une `client_identity` vérifiée appartient à un utilisateur Auth.
- Après OTP ou avec une session existante, créer ou retrouver la relation avec la boutique, présenter le formulaire et enregistrer l'opération immédiatement après le récapitulatif. Aucune approbation préalable du boutiquier et aucun état `pending` ne sont ajoutés.
- Attribuer sans ambiguïté chaque écriture à son acteur et à son canal : rôle `client`, source `shop_qr` et utilisateur Auth vérifié. Ne pas recopier un booléen `phone_verified` dans chaque écriture.
- Afficher immédiatement l'écriture dans l'activité de la boutique. La notification externe reste asynchrone via l'outbox et ne doit pas être présentée comme livrée tant que le fournisseur n'a pas confirmé l'envoi.
- Conserver l'idempotence, la détection des doublons, la révocation du QR, les corrections compensatoires et les contestations existantes.

### Parcours cible

```text
QR boutique permanent
→ boutique identifiée et confirmée
→ session client existante ?
   ├─ oui : relation créée ou retrouvée
   └─ non : téléphone → OTP Supabase Auth
            → compte client léger
            → nom demandé uniquement au premier passage
            → relation créée ou retrouvée
→ article ou service + montant
→ date prévue facultative
→ récapitulatif avec solde avant et après
→ confirmation du client
→ écriture immédiate dans le journal
→ activité boutique mise à jour
→ notification placée dans l'outbox
```

### Travail d'implémentation

- [x] Rendre l'action `Scanner une boutique` visible sur l'accueil client même lorsqu'une ou plusieurs relations existent déjà.
- [x] Conserver la route QR comme point d'entrée unique et afficher d'abord l'identité minimale de la boutique avec une confirmation explicite.
- [x] Si une session client existe, poursuivre directement vers la création ou la récupération de la relation.
- [x] Si aucune session n'existe, lancer un parcours téléphone + OTP qui revient automatiquement vers le QR scanné après authentification.
- [x] Ne révéler l'existence d'un numéro ou d'un profil qu'après validation de l'OTP afin d'empêcher l'énumération des clients.
- [x] Demander le nom uniquement au premier passage d'un nouveau client vérifié.
- [x] Afficher le formulaire d'achat après l'authentification : article ou service, montant et date prévue facultative.
- [x] Ajouter un récapitulatif avant l'écriture avec la boutique, l'article, le montant, le solde actuel et le solde projeté.
- [x] Enregistrer l'opération avec `recorded_by_role = client` et `source_channel = shop_qr`, en utilisant l'identité Auth comme autorité.
- [x] Afficher la provenance dans les vues boutique et client : `Enregistré par le client via le QR de la boutique`.
- [x] Faire apparaître l'opération dans l'activité boutique dès la confirmation serveur, indépendamment du succès de la notification externe.
- [x] Vérifier que l'opération alimente l'outbox sans bloquer le journal lorsque le fournisseur de messages est indisponible.
- [ ] Appliquer les contrôles anti-abus aux demandes OTP et aux écritures : limites de fréquence, idempotence, doublons probables et journalisation des refus.
- [x] Couvrir les trois entrées par des tests navigateur : scanner intégré, caméra normale sans session et caméra normale avec session existante.
- [x] Couvrir par des tests serveur et PostgreSQL l'isolation inter-boutiques, la révocation du QR, le rattachement de la relation, l'autorité de l'acteur et la provenance du journal.
- [ ] Vérifier la totalité du flux sur mobile installé en PWA et dans un navigateur sans application installée.

## Retours du test physique — accueil client et réactivité PWA

### Hiérarchie visuelle

- [x] Recomposer l'accueil client à partir des visuels de référence : solde, trois actions minimales, relations et activité récente forment une seule hiérarchie compacte.
- [x] Conserver volontairement l'espace libre de l'état sans boutique ; ne pas le traiter comme un défaut à remplir. Corriger uniquement la hiérarchie visuelle qui l'entoure.
- [x] Unifier la barre système et le header pour supprimer l'impression de double bande verte et respecter la safe area supérieure iOS.
- [x] Supprimer la navigation inférieure client et placer la navigation boutique au-dessus de la safe area et de l'indicateur d'accueil iOS.
- [x] Ne masquer la navigation racine boutique que lorsqu'un véritable écran focalisé ou formulaire est ouvert ; Acheter et Rembourser sans relation renvoient vers le scanner.
- [x] Donner aux écrans focalisés une navigation native cohérente : bouton retour dans le header, historique de route réel et geste de retour iOS lorsque le navigateur/PWA le permet.

### Mise à jour sans rechargement

- [x] Garantir transactionnellement un QR actif pendant le premier onboarding boutique et précharger le contexte/QR sans rechargement de la PWA.
- [x] Après le renouvellement du QR ou la modification du nom, afficher automatiquement le QR et le nom courant sans rechargement.
- [x] Après qu'un client a scanné le QR ou confirmé une opération, mettre à jour automatiquement le carnet et l'activité du boutiquier sans rechargement manuel.
- [x] Couvrir ces transitions par des tests PWA : création boutique → QR disponible, scan client → client visible côté boutique, opération client → activité boutique visible sur un second contexte déjà ouvert.

### Explicitement hors périmètre

- Formulaire anonyme créant directement une dette.
- Identité globale vérifiée sans utilisateur Auth propriétaire.
- Approbation obligatoire du boutiquier avant inscription au journal.
- File de demandes QR `pending` distincte du journal.
- QR client temporaire.
- QR dynamique par achat.
- Paiement ou transfert d'argent dans Boutikier.
- Affirmation de présence physique fondée uniquement sur le scan : le QR identifie la boutique, il ne prouve pas la localisation du client.

## Intégrations différées

- WhatsApp/SMS réel et OTP : configurer le fournisseur, le numéro expéditeur, les modèles approuvés, Supabase Auth Phone, les limites anti-abus/CAPTCHA et la vérification de livraison de bout en bout.
- Google OAuth : créer les identifiants Google, configurer le fournisseur Supabase et valider les redirections de production.

Ces deux intégrations ne bloquent pas la publication du coeur applicatif. Aucun envoi simulé ne doit être exposé en production tant que le fournisseur correspondant n'est pas configuré.
