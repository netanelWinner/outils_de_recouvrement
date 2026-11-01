# Recouvrement — Proposition d'architecture (étape 0, à valider)

> Application de bureau Windows, mono-utilisatrice, 100 % hors ligne, pour le recouvrement
> des factures d'un hôpital (Pointe-Noire) auprès des pétroliers et de leurs sous-traitants.

---

> **Écarts appliqués en V1 par rapport à cette proposition**
> - **Electron 42** (et non la dernière version) : seule version pour laquelle le module SQLite chiffré est distribué précompilé (voir `BUILD.md`).
> - **SQL écrit à la main** (requêtes paramétrées + migrations versionnées) au lieu de Drizzle ORM : plus simple et plus prévisible.
> - **Composants d'interface maison** (Tailwind) au lieu de shadcn/ui ; tableaux paginés côté base au lieu de TanStack Table.
> - La **logique métier pure** est dans `src/shared/domain/` (testable et réutilisée par l'interface).
> - Le service du **bon de prise en charge** existe dès la V1 (création automatique depuis la facture + contrôle du plafond) ; l'écran de gestion complet arrive en V2.

## 1. Choix techniques

| Besoin | Choix | Pourquoi |
|---|---|---|
| Coque bureau | **Electron** + **electron-vite** | Tout en Node/TypeScript (Tauri imposerait du Rust côté serveur), modules natifs SQLite chiffrés matures, impression PDF intégrée (Chromium). |
| Installateur | **electron-builder (NSIS)** | `.exe` avec raccourci bureau + menu Démarrer, désinstallation propre, choix du dossier d'installation. |
| Mises à jour (V3) | **electron-updater** | Mise à jour en un clic depuis un dossier partagé/GitHub Releases, ou simplement relancer le nouvel installateur (les données sont conservées). |
| Base de données | **SQLite chiffrée** via `better-sqlite3-multiple-ciphers` (format SQLCipher, AES-256) | Synchrone et très rapide (milliers de factures sans souci), fichier unique facile à sauvegarder. |
| Accès aux données | **Drizzle ORM** + migrations SQL versionnées | Typage TypeScript de bout en bout, SQL lisible, migrations automatiques à chaque mise à jour. |
| Interface | **React + TypeScript**, **Tailwind CSS + shadcn/ui** (Radix) | Composants accessibles, sobres et professionnels. |
| Tableaux | **TanStack Table + TanStack Virtual** | Tri, filtres, sélection multiple, virtualisation : fluide avec 10 000+ lignes. Pagination côté base (SQL `LIMIT/OFFSET` + index). |
| Formulaires | **react-hook-form + zod** | Schémas de validation **partagés** entre interface et processus principal ; messages en français. |
| Graphiques | **Recharts** | Simples, lisibles. |
| Dates | **date-fns** (locale `fr`) | |
| PDF | **HTML/CSS → `webContents.printToPDF`** (fenêtre cachée) | Mise en page soignée (en-tête, logo, bloc signature, cachet), rendu fidèle à l'impression, aucun moteur PDF tiers. |
| Excel | **exceljs** ; CSV : **papaparse** | Import avec correspondance de colonnes, export mis en forme. |
| E-mail | **nodemailer** (SMTP) ; brouillon = fichier **.eml** ouvert dans Outlook/Thunderbird | Le brouillon garde les PDF en pièce jointe (impossible avec `mailto:`). |
| WhatsApp | Lien `https://wa.me/242XXXXXXXXX?text=…` ouvert dans le navigateur/WhatsApp Desktop | Gratuit, aucune API. |
| Notifications | `Notification` d'Electron + icône dans la zone de notification | |
| Tests | **Vitest** (logique métier), **Playwright for Electron** (parcours clés) | |

### Sécurité
- **Mot de passe → clé** : dérivation `scrypt` (sel aléatoire) → clé de chiffrement de la base. Le mot de passe n'est **jamais stocké**. Seuls le sel et les paramètres sont dans un petit fichier `auth.json`.
- **Clé de secours** : à la création du compte, l'application affiche une **clé de récupération** (24 caractères) à imprimer et ranger. Sans mot de passe ni clé de secours, les données sont **irrécupérables** — c'est le prix d'un vrai chiffrement.
- **Pièces jointes chiffrées** (AES-256-GCM, même clé) : un scan ne doit pas être lisible si le PC est volé.
- Verrouillage automatique après X minutes d'inactivité (5 par défaut), raccourci `Ctrl+L`.
- Electron durci : `contextIsolation`, `sandbox`, pas de `nodeIntegration`, IPC en **liste blanche typée** validée par zod, CSP stricte, aucune ressource distante.

### Règles transverses
- **Montants en entiers** (unité mineure : XAF sans décimale, USD/EUR en centimes) → zéro erreur d'arrondi.
- **Conversion pour les totaux** : EUR = 655,957 XAF (parité fixe CEMAC) ; taux USD saisi dans les paramètres et historisé.
- **Suppression = corbeille** (`deleted_at`), purge manuelle ou après 30 jours ; bouton « Annuler » (10 s) après chaque action.
- **Journal d'audit** de toute création/modification/suppression (avant/après en JSON).
- **Aucune donnée médicale** : le schéma n'a *aucun* champ diagnostic/acte. Le champ « observations » affiche un rappel et une détection de mots-clés médicaux courants avertit avant enregistrement.

---

## 2. Architecture

```
┌──────────────────────── Processus RENDU (React, sandboxé) ────────────────────────┐
│  Pages : Aujourd'hui · Tableau de bord · Entreprises · Bons · Factures · Paiements │
│          Relances · Journal · Contentieux · Rapports · Paramètres · Corbeille      │
│  TanStack Query ─────────► window.api.*  (pont typé, exposé par le preload)        │
└───────────────────────────────────┬────────────────────────────────────────────────┘
                                    │ IPC (canaux en liste blanche + validation zod)
┌───────────────────────────────────▼──────────── Processus PRINCIPAL (Node) ────────┐
│  ipc/        → routeurs par module                                                  │
│  services/   → cas d'usage (factures, paiements, relances, import, PDF, mail…)      │
│  domain/     → LOGIQUE PURE testée (balance âgée, imputation, pénalités, scénarios, │
│                DSO, score de fiabilité, rapprochement, prescription)                │
│  db/         → SQLite chiffrée, schéma Drizzle, migrations, audit, corbeille         │
│  infra/      → sauvegarde, planificateur, notifications, stockage pièces jointes    │
└─────────────────────────────────────────────────────────────────────────────────────┘
        Données : %APPDATA%\Recouvrement\  (recouvrement.db, pieces\, auth.json, logs\)
```

**Planificateur** : au démarrage, au déverrouillage, puis toutes les heures : génération des relances du jour (idempotente), contrôle des promesses, bons expirants, rejets à re-déposer, prescriptions → notifications. Option « rester dans la zone de notification à la fermeture » pour ne rater aucun rappel. Sauvegarde quotidienne au premier lancement de la journée.

---

## 3. Schéma de base de données

Conventions : `id` INTEGER PK ; `created_at`, `updated_at` ; `deleted_at` (corbeille) sur les tables métier ; montants `*_minor` INTEGER + `currency` ('XAF'|'USD'|'EUR').

### 3.1 Référentiel
```sql
settings            (key TEXT PK, value_json TEXT)              -- hôpital, devise, SMTP, sauvegarde, verrouillage…
assets              (id, kind 'logo'|'signature'|'cachet', mime, data BLOB)
exchange_rates      (id, currency, rate_to_xaf REAL, valid_from DATE)

companies           (id, name UNIQUE, short_name, type 'petrolier'|'sous_traitant'|'autre',
                     parent_company_id → companies NULL,         -- sous-traitant d'un pétrolier
                     niu, rccm, address, city, phone, email, website,
                     default_currency, payment_terms_days, billing_notes,
                     reminder_scenario_id → reminder_scenarios NULL,
                     notes, deleted_at, …)

contacts            (id, company_id →, role 'compta_fournisseurs'|'rh'|'hse_medecin'|
                     'gestionnaire_tiers'|'direction'|'juridique'|'autre',
                     full_name, job_title, email, phone, whatsapp, is_primary,
                     third_party_name NULL,                       -- société tierce de gestion
                     notes, deleted_at, …)

conventions         (id, company_id →, reference, title, start_date, end_date NULL,
                     payment_terms_days, terms_start 'emission'|'depot'|'reception',
                     required_documents_json,                     -- ["PO","bon","feuille de soins signée",…]
                     billing_format_notes,                        -- format exigé (portail, Coupa, Ariba, papier…)
                     penalty_type 'aucune'|'taux_annuel'|'taux_mensuel'|'forfait',
                     penalty_rate REAL, penalty_fixed_minor, penalty_grace_days,
                     currency, status 'active'|'expiree'|'suspendue', deleted_at, …)
```

### 3.2 Bons et factures
```sql
coverage_vouchers   (id, number, company_id →, convention_id →,
                     patient_name NULL, patient_matricule NULL,  -- AU MOINS UN des deux, rien d'autre
                     beneficiary_type 'salarie'|'sous_traitant'|'ayant_droit',
                     subcontractor_name NULL, po_number NULL,
                     issue_date, valid_until, ceiling_minor, currency,
                     status 'actif'|'consomme'|'expire'|'annule', deleted_at, …,
                     UNIQUE(company_id, number))

invoices            (id, number UNIQUE,                           -- pas de doublon
                     kind 'facture'|'avoir',
                     corrects_invoice_id → invoices NULL,         -- avoir / facture rectificative
                     company_id →, convention_id →, voucher_id → NULL, po_number NULL,
                     patient_name NULL, patient_matricule NULL,   -- copie si pas de bon
                     service_date, issue_date, deposit_date NULL, due_date,
                     amount_minor, currency, status, status_changed_at,
                     batch_id → billing_batches NULL, notes, deleted_at, …)
  -- status : 'brouillon'|'envoyee'|'acceptee'|'rejetee'|'partiellement_payee'|'soldee'|'contentieux'|'annulee'
  -- 'partiellement_payee'/'soldee' sont recalculés automatiquement après chaque paiement/avoir.
  -- Index : (company_id, status), (due_date), (issue_date), (voucher_id), FTS5 sur number/patient/po.

invoice_events      (id, invoice_id →, at, type 'statut'|'depot'|'rejet'|'redepot'|'paiement'|
                     'relance'|'note', from_status, to_status, details_json)   -- historique lisible

billing_batches     (id, company_id →, period_start, period_end, reference,  -- facturation groupée /
                     deposit_date, deposit_mode 'main_propre'|'email'|'portail'|'courrier',
                     acknowledgment_ref NULL, deleted_at, …)                   -- bordereau de dépôt
```
Contrôle plafond : somme des factures non annulées d'un bon ≤ `ceiling_minor` (vérifié côté service, refus avec message clair).
Échéance calculée : date de départ (émission, dépôt ou réception selon la convention) + délai contractuel ; **un rejet puis re-dépôt recalcule l'échéance**.

### 3.3 Rejets
```sql
rejections          (id, invoice_id →, rejected_at, reason_code
                       'po_manquant'|'bon_manquant'|'piece_absente'|'mauvais_format'|
                       'montant_errone'|'doublon'|'hors_convention'|'autre',
                     reason_details, missing_document NULL, corrective_action,
                     client_contact_id → contacts NULL, redeposit_due NULL,
                     redeposited_at NULL, status 'ouvert'|'corrige'|'redepose'|'clos', …)
```

### 3.4 Paiements et rapprochement
```sql
payments            (id, company_id →, received_at, method 'virement'|'cheque'|'especes',
                     reference, bank_name NULL, amount_minor, currency,
                     rate_to_xaf REAL, notes, bank_line_id → bank_statement_lines NULL, deleted_at, …)
payment_allocations (id, payment_id →, invoice_id →, amount_minor)   -- 1 paiement → N factures
  -- Somme des imputations ≤ montant du paiement ; le reliquat = avance client non imputée.
credit_allocations  (id, credit_note_id → invoices, invoice_id →, amount_minor)  -- imputation des avoirs

bank_statements     (id, file_name, imported_at, bank_name, period_start, period_end)
bank_statement_lines(id, statement_id →, op_date, label, reference, amount_minor, currency,
                     match_status 'non_rapproche'|'suggere'|'rapproche'|'ignore',
                     suggestion_json)
```
Vue `v_invoice_balance` : montant − paiements imputés − avoirs imputés = **reste dû**.

### 3.5 Relances
```sql
reminder_templates  (id, name, channel 'email'|'whatsapp'|'courrier', tone 'courtois'|'ferme'|
                     'mise_en_demeure', subject, body, requires_legal_review BOOL, is_default, …)
reminder_scenarios  (id, name, is_default)
reminder_steps      (id, scenario_id →, position, offset_days,      -- J+3, J+15, J+30 après échéance
                     channel, template_id →, group_by_company BOOL)
reminder_tasks      (id, company_id →, step_id →, planned_for DATE, channel, template_id →,
                     status 'a_envoyer'|'envoyee'|'reportee'|'ignoree', postponed_to NULL,
                     UNIQUE(company_id, step_id, planned_for))       -- génération idempotente
reminder_task_invoices (task_id →, invoice_id →)
reminders           (id, task_id → NULL, company_id →, contact_id → NULL, channel, template_id,
                     sent_at, subject, body_rendered, pdf_attachment_id NULL,
                     delivery 'envoye_smtp'|'brouillon_eml'|'whatsapp_ouvert'|'imprime')
reminder_invoices   (reminder_id →, invoice_id →)
```
Variables : `{entreprise}` `{contact}` `{n_facture}` `{montant}` `{echeance}` `{jours_retard}` `{liste_factures}` (+ `{hopital}`, `{signataire}`, `{date}`, `{total_du}`).

### 3.6 Journal, promesses, contentieux
```sql
activities          (id, company_id →, contact_id → NULL, type 'appel'|'visite'|'email_recu'|
                     'email_envoye'|'note'|'promesse', occurred_at, summary, next_action_at NULL, …)
activity_invoices   (activity_id →, invoice_id →)
promises            (id, activity_id →, company_id →, promised_amount_minor, currency,
                     promised_date, status 'en_attente'|'tenue'|'partielle'|'non_tenue')

litigation_cases    (id, company_id →, opened_at, handler_type 'avocat'|'huissier'|'interne',
                     handler_name, handler_contact, procedure 'mise_en_demeure'|
                     'injonction_de_payer'|'assignation'|'execution'|'transaction',
                     status 'ouvert'|'suspendu'|'clos_gagne'|'clos_perdu'|'transige', …)
litigation_invoices (case_id →, invoice_id →)
litigation_steps    (id, case_id →, title, due_date, done_at NULL, notes)
litigation_costs    (id, case_id →, date, label, amount_minor, currency)
```
Prescription : 5 ans par défaut (AUDCG OHADA, art. 16), **paramétrable**, alerte à 6 et 3 mois avant — à confirmer par le service juridique.

### 3.7 Transverse
```sql
attachments         (id, owner_type 'company'|'convention'|'voucher'|'invoice'|'rejection'|
                     'payment'|'litigation', owner_id, category, original_name,
                     stored_path, sha256, size, mime, deleted_at, …)
audit_log           (id, at, action, entity, entity_id, before_json, after_json)
import_jobs         (id, at, kind, file_name, mapping_json, rows_ok, rows_error, report_json)
app_meta            (key PK, value)          -- version du schéma, mode démo actif, etc.
```
Données de démonstration marquées `is_demo = 1` → effaçables en un clic sans toucher aux vraies.

---

## 4. Logique métier critique (testée unitairement)

| Module `domain/` | Contenu |
|---|---|
| `aging.ts` | Balance âgée 0-30 / 31-60 / 61-90 / +90 (sur jours de retard ou d'ancienneté, au choix), par entreprise et globale, conversion XAF. |
| `allocation.ts` | Imputation d'un paiement : manuelle, ou automatique « plus anciennes d'abord » ; refus de sur-imputation ; reliquat ; recalcul des statuts. |
| `penalties.ts` | Pénalités : taux annuel/mensuel au prorata des jours, forfait, délai de grâce, plafonnement éventuel. |
| `reminders.ts` | Scénario → tâches du jour : étape due, pas de doublon, exclusion soldées/contentieux/promesse en cours, regroupement par entreprise. |
| `templating.ts` | Remplacement des variables, formatage FR des montants (`1 250 000 FCFA`) et des dates. |
| `due-dates.ts` | Calcul d'échéance (émission/dépôt/réception), recalcul après re-dépôt. |
| `kpi.ts` | Taux de recouvrement, DSO, délai moyen réel, taux de rejet, score de fiabilité, prévisions. |
| `matching.ts` | Rapprochement bancaire : score (montant exact, n° de facture dans le libellé, nom d'entreprise, dates). |

---

## 5. Arborescence du projet

```
Recouvrement/
├─ package.json · electron.vite.config.ts · electron-builder.yml · tsconfig*.json
├─ README.md                         ← guide simple pour l'utilisatrice
├─ docs/ ARCHITECTURE.md · BUILD.md · TESTS-WINDOWS.md
├─ build/  icon.ico · installer.nsh  ← ressources de l'installateur
├─ resources/ templates/             ← modèles HTML des PDF (lettre, mise en demeure, relevé, rapport)
├─ src/
│  ├─ shared/                        ← commun aux deux processus
│  │  ├─ types.ts · constants.ts (statuts, libellés FR, couleurs)
│  │  ├─ schemas/ (zod : company, invoice, payment…)
│  │  └─ ipc-contract.ts             ← liste typée des canaux IPC
│  ├─ main/
│  │  ├─ index.ts · window.ts · tray.ts · security.ts
│  │  ├─ db/ connection.ts · schema/*.ts · migrations/*.sql · audit.ts · trash.ts
│  │  ├─ domain/  aging · allocation · penalties · reminders · templating · due-dates · kpi · matching
│  │  ├─ services/ auth · companies · conventions · vouchers · invoices · payments · rejections ·
│  │  │            reminders · activities · litigation · import-excel · export-excel · pdf ·
│  │  │            mail · whatsapp · backup · demo-data · search · settings
│  │  ├─ infra/   scheduler · notifications · files (pièces jointes chiffrées) · crypto · logger
│  │  └─ ipc/     *.ipc.ts (un routeur par module)
│  ├─ preload/ index.ts              ← expose window.api (pont sécurisé)
│  └─ renderer/
│     ├─ index.html · main.tsx · App.tsx · router.tsx
│     ├─ components/ ui/ (shadcn) · DataTable · StatusBadge · Money · HelpTip · ConfirmDialog ·
│     │              EmptyState · CommandPalette (recherche globale Ctrl+K)
│     ├─ features/ today · dashboard · companies · vouchers · invoices · payments · reminders ·
│     │            journal · litigation · reports · import · settings · trash · onboarding · lock
│     ├─ hooks/ · lib/ (format FR, api client) · styles/
└─ tests/
   ├─ domain/ *.test.ts              ← balance âgée, imputation, pénalités, scénarios…
   ├─ services/ *.test.ts            ← sur base SQLite temporaire
   └─ e2e/ *.spec.ts                 ← parcours clés (Playwright Electron)
```

---

## 6. Livraison

| Version | Contenu |
|---|---|
| **V1** | Connexion/verrouillage, base chiffrée, entreprises + contacts + conventions, factures (bon saisi simplement), avoirs, paiements + imputation, relances 3 canaux + scénario + liste du jour, balance âgée + tableau de bord de base, import/export Excel, PDF avec en-tête et signature, sauvegarde/restauration, corbeille, audit, guide de démarrage, mode démo, installateur `.exe`. |
| **V2** | Gestion complète des bons (plafond, expiration), rejets et litiges, bordereaux de dépôt, agenda « Aujourd'hui » complet + notifications, journal et promesses, relevés de compte, rapprochement bancaire, contentieux + prescription. |
| **V3** | Scores de fiabilité, prévisions d'encaissement, rapport mensuel automatique pour la direction, mises à jour en un clic. |

### À tester impérativement sur un vrai PC Windows
Installation (alerte SmartScreen car l'installateur n'est pas signé), raccourci bureau, désinstallation ; chemins avec espaces/accents ; module natif SQLite ; notifications Windows ; impression des PDF ; envoi SMTP avec la vraie messagerie de l'hôpital ; ouverture WhatsApp (Desktop ou Web) ; sauvegarde sur clé USB et restauration ; verrouillage après inactivité ; mise en veille/réveil.
