# À vérifier sur le vrai PC de l’hôpital

Déjà vérifié automatiquement sur le PC de développement (Windows 11) :
- l’application installée démarre ;
- le mot de passe et la clé de secours ;
- le guide de démarrage et les données de démonstration ;
- les pages, la recherche, le verrouillage ;
- le relevé de compte et la lettre PDF ;
- l’export Excel et la sauvegarde.

Reste à vérifier sur **le PC réel** :

| # | Test | Comment | Résultat attendu |
|---|---|---|---|
| 1 | Installation | Double-clic sur l’installateur → « Informations complémentaires » → « Exécuter quand même » | Icône sur le bureau et dans le menu Démarrer |
| 2 | Antivirus de l’hôpital | Lancer l’application | Pas de blocage (sinon, demander une exception au service informatique) |
| 3 | Chemins avec espaces / accents | Installer dans le dossier proposé, ouvrir des pièces jointes nommées avec accents | Tout s’ouvre normalement |
| 4 | Notifications Windows | Laisser des relances en attente, rouvrir l’application | Notification « Relances du jour » |
| 5 | Impression | Générer une lettre PDF et l’imprimer sur l’imprimante du service | Marges et en-tête corrects, signature lisible |
| 6 | Logo et signature réels | Paramètres → importer le logo et la signature scannée | Bon rendu sur la lettre (taille, fond blanc) |
| 7 | E-mail réel | Paramètres → E-mail → Tester avec la messagerie de l’hôpital | E-mail de test reçu ; sinon « Préparer un brouillon » s’ouvre dans Outlook |
| 8 | WhatsApp | Relance → WhatsApp → Ouvrir | WhatsApp Desktop (ou WhatsApp Web) s’ouvre sur le bon numéro (+242) avec le message |
| 9 | Clé USB | Choisir la clé USB comme dossier de sauvegarde → Sauvegarder maintenant → débrancher → rouvrir | Alerte claire « sauvegarde impossible » ; rebrancher → sauvegarde OK |
| 10 | Restauration | Paramètres → Sauvegarde → Restaurer une sauvegarde | Redémarrage, données de la date choisie |
| 11 | Veille / verrouillage | Windows + L, puis revenir | L’application demande le mot de passe |
| 12 | Import du vrai fichier Excel | Import / Export → Choisir le fichier → Vérifier | Colonnes reconnues ; rapport d’erreurs compréhensible |
| 13 | Volume | Après l’import : recherche, filtres, tri sur plusieurs milliers de factures | Réponse en moins d’une seconde |
| 14 | Désinstallation | Paramètres Windows → Applications → Désinstaller, puis réinstaller | Les données sont retrouvées |
| 15 | Mise en demeure | Faire relire le modèle par le service juridique, puis cocher « validé » | La mention « PROJET » disparaît des lettres |
| 16 | Relevé de la vraie banque (V2) | Rapprochement bancaire → importer le relevé Excel/CSV téléchargé depuis la banque de l’hôpital | Colonnes date / libellé / crédit reconnues ; sinon les associer à la main une fois |
| 17 | Mise à jour V1 → V2 | Installer la 1.1.0 par-dessus la 1.0.0 | Données conservées, nouvelles pages disponibles |
| 18 | Bordereau imprimé | Imprimer un bordereau, le faire tamponner | Cadre « Reçu par le client » assez grand pour le cachet |
| 19 | Rapport mensuel automatique (V3) | Ouvrir l’application le 1er du mois suivant | Notification « Rapport mensuel prêt » ; PDF dans Documents\Recouvrement - Rapports |
| 20 | Envoi du rapport à la direction | Paramètres → Rapports → e-mail de la direction ; Rapports mensuels → « Générer et envoyer » | E-mail reçu avec le PDF en pièce jointe |
| 21 | Mise à jour depuis un fichier | Paramètres → Mises à jour → choisir `Recouvrement-Installation-1.2.0.exe` depuis une installation 1.1.0 | Sauvegarde, installateur lancé, données conservées, fenêtre « Quoi de neuf ? » au redémarrage |
| 22 | Mise à jour en ligne (si utilisée) | Publier latest.yml + installateur sur le serveur, saisir l’adresse, « Rechercher une mise à jour » | Version détectée, téléchargée et installée |
