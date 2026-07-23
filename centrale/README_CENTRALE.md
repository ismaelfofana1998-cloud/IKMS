# IKIGAI Livraison V3 — Espace Centrale (Phase 3)

## Ce que c'est

Le poste de travail des agents et administrateurs : créer des commandes au
téléphone, assigner les ramassages, valider les dépôts et retours au hub,
constituer et assigner les lots de livraison, suivre la performance des
livreurs et la caisse, gérer les comptes, véhicules et zones tarifaires.

## Structure

Une seule page (`centrale.html`) avec un routeur par hash (`#commandes`,
`#ramassage`, etc.) qui monte dynamiquement un module par écran
(`assets/js/panels/*.js`). La sidebar (`shell.js`) se génère selon le rôle du
compte connecté — un agent ne voit pas Performance/Caisse/Utilisateurs.

- `repository.js` : tout l'accès aux données (vues, tables, RPC), un seul
  endroit à modifier si le schéma évolue.
- `ui.js` : aide partagée (modales, tampons de statut, formatage FCFA, copie
  presse-papiers) réutilisée par les 9 écrans.
- Chaque nom de paramètre RPC a été revérifié un par un contre les fonctions
  SQL de la phase 1 (7 RPC utilisées ici, 0 écart).

## Le parti pris visuel

Même famille de marque que l'espace livreur (bandeau sombre = signature
commune aux deux applications), mais pensé pour un poste de travail : sidebar,
tableaux denses, formulaires rapides au clavier. La signature de cet espace :
les statuts sont rendus comme des **tampons encreurs sur bordereau** — cette
entreprise digitalise un métier qui tamponnait des bordereaux papier, le clin
d'œil est assumé et distinct de l'esthétique « tableau de bord de moto » de
l'espace livreur.

## Ce qu'il reste à faire côté Supabase

1. Déployer la fonction Edge : `supabase functions deploy creer-utilisateur`
   (guide en tête de `supabase/functions/creer-utilisateur/index.ts`).
2. Remplir `assets/js/config.public.js` avec l'URL et la clé de ton projet.
3. Créer un premier compte `admin` ou `super_admin` (directement en base ou
   via le Dashboard Supabase) pour te connecter la première fois — la fonction
   Edge exige déjà un appelant autorisé, donc le tout premier compte de chaque
   entreprise doit être créé manuellement une seule fois.

## Périmètre volontairement laissé pour plus tard

- Page publique de suivi (`suivi.html`, référencée par les liens copiés
  depuis "Commandes") : c'est la phase 4, avec l'intégration Wave.
- Historique détaillé par colis (le journal `evenements_colis` existe déjà en
  base ; l'écran de consultation est un ajout simple quand tu en auras besoin).
- Export CSV : les tableaux sont conçus pour en recevoir un facilement
  (même schéma que le module ajouté à l'espace livreur en phase 2).
