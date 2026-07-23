# IKIGAI Livraison V3 — Pages publiques + Wave (Phase 4)

## Ce que c'est

- `expediteur.html` : formulaire public (sans compte) pour envoyer un colis.
  Accédé via `?entreprise=CODE` (le code de l'entreprise, transmis par la
  Centrale ou affiché sur ses supports). Canal `DIRECT`.
- `suivi.html?token=...` : page universelle de partage de position, utilisée
  aussi bien par l'expéditeur que par chaque destinataire. Affiche aussi le
  code (ramassage ou livraison) à donner au livreur.
- `supabase/functions/wave-initier-paiement/` et `wave-webhook/` : la vraie
  intégration Wave (Côte d'Ivoire), checkout + confirmation signée.

## Pré-requis base de données

Exécuter `database/16_phase4_securiser_paiements_et_publics.sql` (après les
phases précédentes). Ce fichier corrige aussi deux failles de sécurité
trouvées pendant la construction de cette phase — voir plus bas.

## Déploiement Wave

1. Créer un compte Wave Business (Côte d'Ivoire) et récupérer la clé API et
   le secret de signature dans le tableau de bord développeur Wave.
2. `supabase secrets set WAVE_API_KEY=... WAVE_SIGNING_SECRET=... APP_BASE_URL=https://tondomaine.ci`
3. `supabase functions deploy wave-initier-paiement`
4. `supabase functions deploy wave-webhook --no-verify-jwt` (indispensable :
   Wave n'envoie pas de session Supabase, seulement sa propre signature).
5. Dans le tableau de bord Wave, enregistrer l'URL de webhook :
   `https://<TON_PROJET>.supabase.co/functions/v1/wave-webhook`

## ⚠️ Deux failles de sécurité trouvées et corrigées pendant cette phase

En préparant l'intégration paiement, deux problèmes réels ont été détectés
dans les fonctions livrées en phase 1 — corrigés dans
`16_phase4_securiser_paiements_et_publics.sql` et couverts par des tests
négatifs permanents dans `test_e2e_v3.sql` :

1. **Critique** — `rpc_confirmer_paiement` (censée n'être appelable que par
   le webhook Wave via la clé `service_role`) était en réalité exécutable par
   n'importe quel visiteur non connecté, permettant de marquer n'importe quel
   paiement comme réglé sans jamais passer par Wave. Cause : en PostgreSQL,
   `REVOKE ... FROM anon, authenticated` ne suffit pas à protéger une fonction
   qui reste exécutable par tous via le droit par défaut accordé à `PUBLIC` à
   la création — il faut explicitement `REVOKE ... FROM PUBLIC`. Corrigé avec
   une seconde ligne de défense : la fonction vérifie maintenant elle-même
   que l'appelant porte le rôle `service_role`.
2. **Réelle** — `rpc_encaisser_especes` et `rpc_initier_paiement_wave`
   n'importe quel compte authentifié (même un expéditeur auto-inscrit)
   pouvait les appeler sur n'importe quel colis et le marquer payé. Corrigé :
   ces fonctions exigent maintenant que l'appelant soit le livreur activement
   assigné au lot du colis, que le colis soit au statut `EN_TOURNEE`, et
   qu'aucun paiement `PAYE` n'existe déjà dessus.

## Ce qui a aussi été mis à jour ailleurs

- **Espace livreur (phase 2)** : `repository.js.initierPaiementWave()` appelle
  maintenant la vraie fonction Edge (avant : insérait juste une ligne en base
  sans jamais contacter Wave). `app.js` affiche le vrai `wave_launch_url` en
  lien cliquable — obligatoire selon la documentation Wave, qui interdit de
  l'ouvrir en webview ou de le capturer par fetch.

## Ce qui reste volontairement pour plus tard

- Pages `paiement-confirme.html` / `paiement-echoue.html` (redirections
  `success_url`/`error_url` de Wave) : de simples pages d'accusé de réception,
  à habiller quand tu auras choisi le wording exact.
- Orange Money / MTN MoMo : l'architecture (`paiements.methode`, un module par
  fournisseur) les accueille sans rien casser, comme prévu dès la phase 1.
