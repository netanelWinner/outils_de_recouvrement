# Recouvrement – Guide d’utilisation

Application de suivi des factures et des relances, pour le service recouvrement de l’hôpital.
Elle fonctionne **sans internet** (internet sert uniquement à envoyer des e-mails et à ouvrir WhatsApp).
Toutes les données sont **chiffrées** et protégées par votre mot de passe.

---

## 1. Installer l’application

1. Double-cliquez sur le fichier **`Recouvrement-Installation-1.2.1.exe`**.

> **Mettre à jour** une version déjà installée : ouvrez l’application → Paramètres → **Mises à jour** →
> « Choisir le fichier d’installation… ». Une sauvegarde est faite, puis la nouvelle version s’installe.
> Vos données sont conservées. Au redémarrage, une fenêtre « Quoi de neuf ? » présente les nouveautés.
2. Windows peut afficher un écran bleu « Windows a protégé votre ordinateur ».
   C’est normal pour une application qui n’est pas vendue dans le commerce :
   cliquez sur **« Informations complémentaires »**, puis sur **« Exécuter quand même »**.
3. Suivez l’assistant (Suivant → Installer → Terminer).
4. Une icône **Recouvrement** apparaît sur le bureau.

> Pour désinstaller : Paramètres Windows → Applications → Recouvrement → Désinstaller.
> Vos données ne sont **pas** effacées : une réinstallation les retrouve.

## 2. Premier lancement

1. **Choisissez un mot de passe**, avec au moins 8 caractères, des lettres et un chiffre.
2. L’application affiche votre **clé de secours** (6 groupes de 4 caractères).
   **Imprimez-la et rangez-la en lieu sûr**, ailleurs que dans l’ordinateur.
   Si vous oubliez votre mot de passe, c’est le **seul moyen** de récupérer vos données.
3. Le **guide de démarrage** vous demande ensuite :
   - le nom et l’adresse de l’hôpital, avec son logo (pour l’en-tête des lettres) ;
   - votre nom, votre fonction et votre signature scannée (pour le bas des lettres) ;
   - un dossier de sauvegarde (de préférence une clé USB ou un dossier OneDrive / Google Drive).
4. Pour vous entraîner, choisissez **« Découvrir avec des données fictives »**.
   Pour les effacer ensuite : Paramètres → Démonstration → « Effacer les données de démonstration ».

## 3. Votre routine

| Quand | Quoi |
|---|---|
| **Chaque matin** | Ouvrez **Aujourd’hui** : relances prêtes à envoyer, promesses non tenues, rejets à redéposer, bons qui expirent, échéances de contentieux. Une notification Windows vous résume la journée. |
| **À chaque facture** | Bouton **Nouvelle facture** : entreprise, n° de bon de prise en charge, n° de PO, montant, date de dépôt. |
| **À chaque paiement reçu** | Bouton **Paiement reçu** : montant, puis « Imputer automatiquement » pour le répartir sur les factures. |
| **À chaque rejet** | Ouvrez la facture, cliquez sur **Enregistrer un rejet** et indiquez le motif. Corrigez, puis cliquez sur **Redéposer** : le délai repart de cette date. |
| **En fin de mois** | **Tableau de bord** : exportez la balance âgée. Sur la fiche d’une entreprise : **Relevé de compte (PDF)**. |

### Les autres outils du quotidien

| Menu | À quoi ça sert |
|---|---|
| **Bons de prise en charge** | Tous les bons, avec leur plafond, ce qui a déjà été facturé et leur date de validité. Un bon qui expire dans moins de 15 jours apparaît dans **Aujourd’hui**. En tapant le n° d’un bon connu dans une facture, le patient et le PO se remplissent tout seuls. |
| **Bordereaux de dépôt** | Pour déposer d’un coup toutes les factures d’une entreprise sur un mois. Choisissez l’entreprise et la période : un bordereau PDF est créé. Faites-le tamponner par le client ; c’est votre preuve de dépôt. |
| **Rejets** | La liste des factures refusées par les clients, avec la pièce manquante et l’action à mener. Cliquez sur **Redéposer** une fois la facture corrigée. Le panneau de droite montre les motifs les plus fréquents, pour éviter qu’ils se répètent. |
| **Échanges et promesses** | Après chaque appel ou visite, cliquez sur **Noter un échange**. Si le client promet de payer, cochez « Le client a promis de payer » : les relances s’arrêtent jusqu’à la date promise. Si rien n’arrive, une alerte rouge apparaît le lendemain. |
| **Rapprochement bancaire** | Téléchargez le relevé depuis la banque en ligne (Excel ou CSV), puis importez-le. Pour chaque virement reçu, l’application propose les factures correspondantes : cliquez sur **Valider**. |
| **Contentieux** | Quand le dossier part chez l’avocat ou l’huissier : étapes avec dates, frais, documents. La page signale aussi les créances anciennes proches de la **prescription** (5 ans, à confirmer avec le juridique). |

### Pour piloter et rendre compte à la direction

| Menu | À quoi ça sert |
|---|---|
| **Prévisions** | Combien devrait rentrer ce mois-ci et les 2 suivants, facture par facture. Le montant « probable » tient compte de la fiabilité de chaque client, de l’ancienneté des factures et des promesses de paiement. |
| **Fiabilité des clients** | Une note de **A** (très fiable) à **E** (à risque) pour chaque entreprise, calculée sur son historique réel : retard moyen, factures payées à l’échéance, rejets, promesses tenues. Concentrez vos relances sur les notes D et E qui doivent le plus. |
| **Rapports mensuels** | Le rapport PDF du mois écoulé est **créé automatiquement** au premier lancement de chaque mois, et peut être envoyé à la direction par e-mail (Paramètres → Rapports). Vous pouvez y ajouter un commentaire et le régénérer à tout moment. |

## 4. Les relances sur 3 canaux

- **E-mail** : « Envoyer maintenant » (si l’e-mail est configuré dans Paramètres → E-mail),
  ou « Préparer un brouillon », qui ouvre le message dans Outlook.
- **WhatsApp** : « Ouvrir dans WhatsApp » ouvre la conversation avec le message déjà écrit ; il ne reste qu’à appuyer sur Envoyer.
- **Courrier** : « Générer la lettre PDF » crée une lettre avec l’en-tête de l’hôpital et votre signature, prête à imprimer.

Le calendrier des relances (par exemple rappel à J+3, relance ferme à J+15, mise en demeure à J+30)
se règle dans **Relances → Scénario automatique**. Les textes se modifient dans **Relances → Modèles de messages**.

> ⚖️ **Mise en demeure** : faites toujours valider le modèle par le **service juridique de l’hôpital**.
> Tant que la case « validé par le service juridique » n’est pas cochée dans le modèle,
> les lettres portent la mention « PROJET ».

## 5. Confidentialité médicale

Ne saisissez **jamais** de diagnostic, de maladie ou d’acte médical.
Seuls sont autorisés : le nom **ou** le matricule du patient, la date, le montant et le n° de bon.
L’application vous avertit si elle détecte un mot médical.

## 6. Sécurité et sauvegardes

- L’application se **verrouille** toute seule après 5 minutes sans activité (réglable dans Paramètres → Sécurité),
  ou immédiatement avec **Ctrl + L**.
- Une **sauvegarde** est faite automatiquement chaque jour dans le dossier choisi.
  Pour restaurer : Paramètres → Sauvegarde → « Restaurer ».
- Rien n’est supprimé d’un coup : tout passe par la **Corbeille** (restaurable pendant 30 jours).
- Le **Journal d’audit** garde la trace de toutes les actions.

## 7. Raccourcis clavier

| Touches | Action |
|---|---|
| Ctrl + K | Rechercher (facture, patient, bon, entreprise) |
| Ctrl + N | Nouvelle facture |
| Ctrl + Maj + P | Paiement reçu |
| Ctrl + L | Verrouiller |
| F1 | Aide |

## 8. En cas de problème

| Problème | Solution |
|---|---|
| Mot de passe oublié | Écran de connexion → « Mot de passe oublié ? » → saisissez la clé de secours. |
| « Le fichier est ouvert dans Excel » | Fermez le fichier dans Excel, puis recommencez l’export. |
| Un e-mail ne part pas | Paramètres → E-mail → « Tester ». Pour Gmail ou Outlook, il faut un « mot de passe d’application ». En attendant, utilisez « Préparer un brouillon ». |
| Sauvegarde impossible | La clé USB est sans doute débranchée : rebranchez-la, ou choisissez un autre dossier. |
| Une facture a disparu | Regardez dans la **Corbeille**. |
