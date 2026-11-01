# Développement et construction de l’installateur

## Prérequis

- Windows 10/11 64 bits
- Node.js 22 ou plus récent (testé avec Node 24), npm 11

> **Pourquoi Electron 42 ?** Le module SQLite chiffré (`better-sqlite3-multiple-ciphers`) n’est
> distribué précompilé que jusqu’à Electron 42 (ABI 146). Ce choix évite d’installer
> Visual Studio Build Tools et Python. L’application étant 100 % hors ligne, sans contenu
> distant, ce n’est pas un risque de sécurité pratique. Pour monter de version : vérifier que les
> binaires précompilés existent pour la nouvelle version, ou installer les outils de compilation.

## Commandes

```powershell
npm install            # dépendances + module natif pour Electron (scripts autorisés dans package.json → allowScripts)
npm run dev            # lance l'application en mode développement (rechargement à chaud)
npm run typecheck      # vérification TypeScript
npm test               # tests unitaires de la logique métier (67 tests)
npm run test:db        # tests d'intégration sur une vraie base chiffrée + performances (32 tests, exécutés dans Electron)
npm run build          # compile main / preload / renderer dans out/
npm run test:e2e -- <dossier-captures>      # test de bout en bout de l'application réelle (après build)
npm run audit:visuel -- <dossier> ["1366x768,1100x700"]   # détecte tout texte qui déborde, à chaque taille d'écran
npm run dist           # icône + build + installateur : dist\Recouvrement-Installation-<version>.exe
```

Tester l’exécutable empaqueté (après `npm run dist`) :

```powershell
$env:E2E_EXE = (Resolve-Path 'dist\win-unpacked\Recouvrement.exe').Path
node tests/e2e/smoke.mjs .\captures
Remove-Item Env:E2E_EXE
```

Si `npm install` refuse d’exécuter les scripts d’installation (npm 11) :
`npm install-scripts approve better-sqlite3-multiple-ciphers electron electron-winstaller`.

## Variables d’environnement (tests uniquement)

| Variable | Effet |
|---|---|
| `RECOUVREMENT_DATA_DIR` | Dossier de données isolé (au lieu de `%APPDATA%\Recouvrement`). Les sauvegardes par défaut vont dans un sous-dossier. |
| `RECOUVREMENT_OPEN_FILE` | Fichier Excel/CSV ouvert à la place de la boîte de dialogue (import, relevé bancaire). |
| `RECOUVREMENT_AUTOSAVE_DIR` | Les PDF, fichiers Excel et brouillons sont écrits dans ce dossier, sans boîte de dialogue ni ouverture. |

## Publier une nouvelle version

1. Augmenter `version` dans `package.json` et ajouter une entrée en tête de `CHANGELOG` dans `src/shared/version.ts`
   (affichée une fois à l’utilisatrice dans « Quoi de neuf ? »).
2. Si le schéma change : ajouter une **nouvelle** migration dans `src/main/db/migrations.ts` (ne jamais modifier les anciennes).
3. `npm run dist` → `dist\Recouvrement-Installation-x.y.z.exe`, `dist\latest.yml`, `dist\*.blockmap`.
4. Distribution, au choix :
   - **Par fichier** (le plus simple) : envoyer l’installateur ; l’utilisatrice fait Paramètres → Mises à jour →
     « Choisir le fichier d’installation… » (sauvegarde automatique, puis installation ; données conservées).
   - **En ligne** : déposer `latest.yml`, l’installateur et le `.blockmap` dans un même dossier web en HTTPS
     (GitHub Releases, hébergement statique…), puis saisir l’adresse de ce dossier dans Paramètres → Mises à jour.
     L’application vérifie, télécharge, fait une sauvegarde puis redémarre sur la nouvelle version.
     L’adresse inscrite dans `electron-builder.yml` (`https://mises-a-jour.invalid/…`) n’est qu’un emplacement réservé :
     c’est celle des paramètres qui est utilisée.

## Emplacement des données

`%APPDATA%\Recouvrement\` : `recouvrement.db` (SQLCipher, AES-256), `auth.json` (clé maîtresse enveloppée
par le mot de passe et par la clé de secours, scrypt + AES-256-GCM), `pieces\` (pièces jointes chiffrées).
