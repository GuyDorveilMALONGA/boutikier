# Design QA — PWA Boutikier

## Sources visuelles

- Direction client : `C:\Users\DELL\AppData\Local\Temp\codex-clipboard-43302dc9-7b5b-4130-977e-57f70483fd00.png`
- Direction boutique / respiration Wave : `C:\Users\DELL\AppData\Local\Temp\codex-clipboard-72091de5-76f2-49c5-9926-2af9a8f5156d.png`
- Contrainte produit complémentaire : fond gris chaud clair, cartes détachées, aucune barre d'onglets client, trois actions client et trois onglets boutique.

Les références sont des directions de hiérarchie et de densité, pas des maquettes à copier pixel par pixel. Le profil supérieur de la référence client, les couleurs Wave, ses illustrations et ses catégories sont explicitement hors cible.

## Preuves d'implémentation

- Accueil client : `.artifacts/design-qa/client-home-v1.png`
- Carnet boutique, première itération : `.artifacts/design-qa/shop-carnet-v1.png`
- Carnet boutique corrigé : `.artifacts/design-qa/shop-carnet-v2.png`
- Activité boutique : `.artifacts/design-qa/shop-activity-v1.png`
- Comparaison client : `.artifacts/design-qa/comparison-client.png`
- Comparaison boutique : `.artifacts/design-qa/comparison-shop.png`

## Normalisation

- Viewport CSS testé : `393 × 852`.
- Capture d'implémentation : `393 × 852` pixels, device scale factor observé `1.25`; le navigateur produit une capture normalisée à la taille CSS.
- Source client : `393 × 706` pixels, conservée à largeur native puis alignée en haut dans le comparatif `796 × 852`.
- Source Wave : `499 × 1080` pixels, redimensionnée à `393 × 852` dans le comparatif `796 × 852`.
- État client : compte client de test connecté, une relation, montants visibles, aucune activité récente.
- État boutique : compte boutique de test connecté, une relation, solde nul, QR actif.

## Comparaison plein écran

### Client

- La carte de dette domine comme la carte de solde de la référence, mais utilise le vert Boutikier et un fond gris chaud conforme au brief.
- Les trois actions sont immédiatement sous la carte ; Scanner est central et légèrement prioritaire.
- Le compte est accessible par l'engrenage supérieur gauche, sans profil ni texte de site dans le header.
- La liste relationnelle reprend la densité d'une liste de transactions et conserve un grand espace volontaire quand il n'y a pas d'autre contenu.
- Aucune barre d'onglets inférieure n'est rendue.

### Boutiquier

- Le QR est l'objet central du Carnet, précédé du montant global et suivi directement du journal des clients.
- La typographie est compacte, les cartes sont nettement détachées du fond et les trois onglets restent lisibles au-dessus de la safe area.
- La comptabilité détaillée n'est plus dans le Carnet ; elle apparaît dans Activité sous une forme compacte.

## Surfaces de fidélité

- **Typographie :** Inter/system, petites capitales pour les catégories, titres de 20–31 px et corps de 9–13 px. La hiérarchie est lisible sans titres massifs.
- **Espacement :** respiration supérieure client de 102 px plus safe area ; rythme de 9–35 px entre cartes, actions et sections. Le Carnet garde le QR et une première fiche client dans le viewport.
- **Couleurs :** fond `#f2f2ee`, cartes `#fffefa`, vert produit existant, orange uniquement pour les montants dus. Aucun dégradé décoratif ni glassmorphism.
- **Images et icônes :** le QR est généré comme image nette avec correction H ; les actions utilisent la bibliothèque d'icônes existante. Aucun asset Wave n'est copié.
- **Texte :** libellés courts et métier : Acheter, Scanner, Rembourser, À recevoir, Clients qui doivent, Activité et Compte.

Les régions importantes sont suffisamment lisibles dans les captures 393 × 852 : carte de dette + actions côté client et carte QR + début du journal côté boutique. Aucun recadrage ciblé supplémentaire n'était nécessaire.

## Historique des itérations

### Itération 1 — résultat bloqué

- **[P2] QR boutique trop haut.** Dans `shop-carnet-v1.png`, la carte QR de 252 px repoussait la première fiche client sous la navigation mobile.
- Correction : QR réduit à 196 px, marges verticales et padding de la carte réduits, sans réduire la zone de silence du QR ni sa correction d'erreur.

### Itération 2 — preuve après correction

- `shop-carnet-v2.png` montre le QR centré, le titre « Clients qui doivent », la recherche et la première fiche client avant la barre inférieure.
- `comparison-shop.png` confirme une densité comparable à Wave tout en respectant l'architecture propre à Boutikier.
- Aucun P0, P1 ou P2 restant.

## Interactions et navigateur

- Connexion client et boutique avec les comptes de test.
- Navigation Carnet → fiche client → retour.
- Navigation Carnet → Activité.
- Paramètres client et déconnexion.
- QR affiché comme image nommée et scannable.
- Console vérifiée après navigation : aucune erreur ni alerte.

## Suivi P3

- La perception exacte des safe areas et du geste retour doit encore être observée sur l'iPhone physique installé en PWA.
- La densité des listes longues sera revue pendant le test physique avec de vraies opérations de démonstration.

final result: passed
