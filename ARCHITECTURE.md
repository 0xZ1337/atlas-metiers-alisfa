# Atlas des métiers ALISFA — Architecture backend

Document d'architecture pour le passage du prototype HTML statique à un système d'information vivant et paritaire.

Version 1.0 · 27 avril 2026

---

## 1. Incohérences constatées dans le prototype et solutions

Les douze points ci-dessous regroupent les incohérences identifiées sur le mockup actuel (`atlas-metiers-alisfa-v2.html`) et la page existante `alisfa.fr/emploi-et-formation/gpec/`. Pour chacune, une solution backend est proposée.

| # | Incohérence | Solution backend |
|---|-------------|------------------|
| 1 | Données en mémoire — 25 métiers et 16 compétences hardcodés en JavaScript. Aucune persistance, pas d'évolution possible sans redéploiement. | Stockage relationnel PostgreSQL avec entités `metier`, `competence`, `metier_competence`, `passerelle`, `famille`. Schéma SQL fourni en section 3. |
| 2 | Aucun versioning du référentiel — pas d'historique des modifications, pas de retour arrière. La CPNEF est paritaire : toute modification est un acte de négociation qui doit être tracé. | Event sourcing léger : table `referentiel_event` qui journalise toutes les modifications. Vue matérialisée du référentiel courant. Diff visualisable entre deux versions. |
| 3 | Pas de workflow de validation — n'importe qui peut modifier le référentiel, alors que les modifications doivent être validées par les deux collèges (employeurs et salariés). | Workflow de proposition (« Pull Request paritaire ») : toute modification est d'abord une proposition qui doit recevoir une validation côté employeur ET une validation côté représentation salariée avant fusion. Tables `proposition`, `validation`. |
| 4 | Trois sources de vérité métier — fiches PDF CPNEF (téléchargements), JobMap externe (cognito.fr), atlas du prototype. Toutes désynchronisées. | Source unique : la base PostgreSQL. Génération à la volée des PDF via service de rendu (Weasyprint ou Puppeteer côté serveur). Pas de PDF statique stocké. |
| 5 | Trames DOCX figées — les formulaires d'entretien sont des fichiers Word téléchargeables. Aucun pré-remplissage possible avec les données métier ou compétences détenues par le salarié. | Service de génération de trame avec moteur de templates (DOCX via python-docx ou docxtpl). Pré-remplissage à partir des données de l'utilisateur connecté. Export PDF parallèle. |
| 6 | Réforme du 24 octobre 2025 non intégrée — le kit ALISFA emploie encore « entretien professionnel » et la périodicité 2 ans, alors que la loi nº 2025-989 a réécrit l'article L6315-1 (entretien de parcours professionnel, périodicité 4 ans, application 1ᵉʳ octobre 2026). | Système de feature-flag legal : entité `cadre_legal` avec date d'entrée en vigueur. Bascule automatique au 1ᵉʳ octobre 2026. Fenêtre transitoire avec affichage dual « ancien régime / nouveau régime ». |
| 7 | Compétences sans nomenclature de référence — niveaux 1/2/3 arbitraires, sans rattachement à France compétences, RNCP ou ROME. | Champs optionnels d'alignement : `code_rome`, `code_rncp`, `niveau_cec` (Cadre européen des certifications). Permet la passerelle vers France Travail et CPF. |
| 8 | Salaires et coefficients CCN absents ou figés — le coefficient évolue par avenant, le salaire dépend de la valeur du point. | Entité `grille_ccn` versionnée par avenant. Calcul du salaire en service : `salaire = coef × valeur_point + indemnite_differentielle_smic`. La valeur du point est mise à jour par avenant et historisée. |
| 9 | Aucune analytique — impossible de savoir quels métiers sont consultés, quelles passerelles intéressent, quelles compétences manquent au référentiel. La CPNEF négocie à l'aveugle. | Pipeline analytique anonymisé : Matomo (cohérent avec alisfa.fr) ou auto-hébergé Plausible. Table `usage_event` pour les requêtes métier. Tableau de bord négociateur. |
| 10 | Pas d'API ouverte — partenaires SIRH des structures, France Travail, OPCO Cohésion, Transitions Pro ne peuvent rien lire de manière structurée. | API REST publique en lecture, OpenAPI documentée, rate-limitée. Authentification optionnelle pour les volumes élevés. Endpoints stables `/api/v1/metiers`, `/api/v1/competences`, `/api/v1/passerelles`. |
| 11 | Aucune authentification ni rôle — la page actuelle est intégralement publique. Le mode édition CPNEF nécessite identification et habilitation paritaire. | Authentification déléguée via OIDC (compatibilité espace adhérent ALISFA existant). RBAC : `public`, `salarie`, `employeur`, `negociateur_employeur`, `negociateur_salarie`, `admin`. Voir section 4. |
| 12 | Trames PDF/DOCX non accessibles — pas garantie WCAG 2.1 AA, lecteurs d'écran non testés. | Génération via templates accessibles (PDF/UA) et HTML semantic alternative. Tests automatisés axe-core en CI. Audit RGAA pour la branche. |

Quatre incohérences additionnelles identifiées en seconde lecture :

| # | Incohérence | Solution |
|---|-------------|----------|
| 13 | Périmètre flou — l'outil mélange information GPEC, préparation d'entretien, simulation de financement et passerelles. Risque de complexité. | Séparation des bornes : un service `referentiel-svc` (données froides), un service `entretien-svc` (préparation + trames), un service `simulation-svc` (financement). API gateway commune. |
| 14 | Pas de bilingue ni de variante DROM-COM — ALISFA a des structures en outre-mer avec des spécificités locales. | Champs `i18n` JSONB sur les entités libelables. Drapeau `region_specifique` sur les passerelles régionales (PREC). |
| 15 | Pas de gestion des suppressions — un métier supprimé du référentiel (rare, mais possible) doit conserver les fiches historiques pour les salariés en cours de carrière. | Soft delete avec champs `deprecated_at`, `successor_id`. Affichage en mode lecture seule des métiers historiques avec redirection vers le successeur. |
| 16 | Pas de gestion d'urgence — en cas d'erreur publiée (ex. coefficient erroné), pas de mécanisme de retrait rapide. | Statut `published`, `under_review`, `withdrawn`. Le retrait peut être déclenché par un admin sans nécessiter le workflow paritaire complet (avec notification immédiate aux co-présidents CPNEF). |

---

## 2. Principes directeurs

Avant le détail technique, quatre principes qui guident l'ensemble.

**Le référentiel est un objet paritaire vivant.** Il n'appartient ni au prestataire technique, ni à un seul collège. Toute modification structurelle est une proposition, soumise au regard des deux collèges, traçable.

**La donnée publique reste publique.** Les fiches métiers, le référentiel de compétences, les passerelles et la grille CCN sont des informations de service public sectoriel. Pas de paywall, pas de connexion exigée pour la consultation.

**L'identification sert l'usage, pas le contrôle.** Un salarié peut tout consulter sans compte. Le compte permet seulement de sauvegarder ses parcours et de pré-remplir une trame d'entretien.

**Pas de surcouche superflue.** Les outils existants (espace adhérent, OPCO Cohésion, Transitions Pro, moncompteformation) restent les références. L'atlas s'y connecte au lieu de les dupliquer.

---

## 3. Modèle de données

### 3.1 Entités principales

```
famille (5 entrées)
├── id (uuid)
├── code (text, unique : 'animation', 'petite_enfance', 'encadrement', 'administratif', 'services')
├── libelle (text)
├── couleur (text, hex)
└── ordre (int)

metier (≈ 25, évolutif)
├── id (uuid)
├── code (text, unique, slug)
├── famille_id (fk famille)
├── libelle (text)
├── une_phrase (text)            -- accroche
├── description (text)            -- description longue
├── code_rome (text, nullable)    -- alignement France Travail
├── code_rncp (text, nullable)
├── niveau_cec (int, nullable, 1-8)
├── deprecated_at (timestamp, nullable)
├── successor_id (uuid, nullable, fk metier)
├── status (enum : draft, published, withdrawn)
├── created_at, updated_at, version (int)

competence (≈ 16, évolutif)
├── id (uuid)
├── code (text, unique, slug)
├── categorie (text)              -- 'relationnel', 'pedagogique', etc.
├── libelle (text)
├── description (text)
├── status (enum)
├── version (int)

metier_competence (table de liaison ; ≈ 130 entrées)
├── metier_id (fk metier)
├── competence_id (fk competence)
├── niveau_attendu (int, 1-3)
├── obligatoire (bool, default true)
└── PRIMARY KEY (metier_id, competence_id)

passerelle (≈ 50 entrées, asymétrique)
├── id (uuid)
├── metier_source_id (fk metier)
├── metier_cible_id (fk metier)
├── duree_estimee_mois (int)
├── note_paritaire (text)         -- justification CPNEF
├── status (enum)
└── UNIQUE (metier_source_id, metier_cible_id)

grille_ccn (versionnée par avenant)
├── id (uuid)
├── metier_id (fk metier)
├── coef_embauche (int)
├── coef_senior (int)
├── salaire_brut_estime (int)     -- calculé, snapshot
├── valeur_point_id (fk valeur_point)
├── avenant_id (fk avenant_ccn)
└── valid_from, valid_until

valeur_point
├── id (uuid)
├── valeur (numeric)
├── valid_from (date)
├── avenant_id (fk avenant_ccn)
└── valid_until (date, nullable)
```

### 3.2 Versioning paritaire

```
proposition
├── id (uuid)
├── titre (text)
├── description (text)             -- argumentaire pour CPNEF
├── auteur_id (fk user)
├── collegue_auteur (enum : 'employeur', 'salarie')
├── type (enum : 'metier_create', 'metier_update', 'competence_create',
                 'competence_update', 'passerelle_create', 'passerelle_update',
                 'grille_update', 'metier_deprecate', ...)
├── payload (jsonb)                -- diff structuré
├── status (enum : 'open', 'merged', 'rejected', 'withdrawn')
├── created_at, merged_at, rejected_at

validation
├── id (uuid)
├── proposition_id (fk proposition)
├── valideur_id (fk user)
├── collegue_valideur (enum : 'employeur', 'salarie')
├── verdict (enum : 'accord', 'refus', 'reserve')
├── commentaire (text)
└── created_at

referentiel_event                  -- journal d'audit append-only
├── id (bigserial)
├── proposition_id (fk proposition, nullable)
├── action (text)                  -- 'metier.created', 'competence.updated', ...
├── target_id (uuid)
├── target_type (text)
├── before (jsonb)
├── after (jsonb)
├── actor_id (fk user)
├── created_at (timestamp)
```

### 3.3 Règle de fusion paritaire

Une proposition passe au statut `merged` quand elle reçoit :

- au moins une `validation` avec `collegue_valideur = 'employeur'` et `verdict = 'accord'`,
- ET au moins une `validation` avec `collegue_valideur = 'salarie'` et `verdict = 'accord'`,
- ET aucune `validation` avec `verdict = 'refus'` non levée.

Les `verdict = 'reserve'` ne bloquent pas la fusion mais sont tracés et inscrits au compte rendu de séance.

### 3.4 Génération des trames

```
trame_template (peu d'entrées, géré par admin technique)
├── id (uuid)
├── code (text, unique : 'entretien_parcours_2026', 'bilan_6_ans')
├── version_legale (text)         -- 'L6315-1 v2025'
├── docx_template (binary blob)   -- template avec placeholders
└── valid_from (date)             -- bascule au 1er octobre 2026

trame_instance (générée à la demande)
├── id (uuid)
├── template_id (fk trame_template)
├── salarie_id (fk user)
├── employeur_id (fk user, nullable)
├── donnees (jsonb)               -- métier exercé, compétences, projet, etc.
├── docx_path (text)              -- S3
├── pdf_path (text)               -- S3
├── status (enum : 'draft', 'shared', 'signed')
└── created_at
```

---

## 4. Authentification et rôles (RBAC)

### 4.1 Rôles

| Rôle | Description | Lecture | Écriture | Édition |
|------|-------------|---------|----------|---------|
| `public` | Visiteur non identifié | Tout | Aucune | — |
| `salarie` | Salarié de la branche, identifié | Tout + ses propres trames | Ses trames + son profil | — |
| `employeur` | Direction ou RH d'une structure | Tout + trames de ses salariés (si invité) | Trames partagées | — |
| `negociateur_employeur` | Représentant du collège employeurs en CPNEF | Tout + propositions | + propositions paritaires | + validations côté employeur |
| `negociateur_salarie` | Représentant d'organisation syndicale en CPNEF | Tout + propositions | + propositions paritaires | + validations côté salarié |
| `admin_technique` | Équipe technique ALISFA | Tout | Templates, paramètres système | Retrait d'urgence |

### 4.2 Authentification

Délégation OIDC vers le SI ALISFA. Cohérence avec l'espace adhérent existant (`alisfa.fr/espace-adherent`). Pour les négociateurs, attribution manuelle par l'admin sur la base de la composition CPNEF en vigueur.

Compte salarié optionnel — création automatique au premier usage avec email + lien magique. Aucune donnée personnelle stockée hors email tant que l'utilisateur ne sauvegarde pas un parcours.

### 4.3 RGPD

Données personnelles sur les salariés limitées à : email (clé), parcours sauvegardés, trames d'entretien générées. Pas de données de santé, pas de salaire individuel. Effacement à la demande, en 30 jours maximum. Registre des traitements maintenu côté ALISFA.

---

## 5. API publique

API REST documentée OpenAPI 3, versionnée (`/api/v1`).

### 5.1 Endpoints de lecture (publics)

```
GET  /api/v1/familles
GET  /api/v1/metiers                      ?famille=&search=&page=
GET  /api/v1/metiers/{code}
GET  /api/v1/competences
GET  /api/v1/competences/{code}
GET  /api/v1/passerelles                  ?source=&cible=
GET  /api/v1/grille-ccn                   ?metier=&date=
GET  /api/v1/dispositifs                  -- VAE, CPF, CEP, bilan, OPCO, PRO-A, PTP
GET  /api/v1/trames/templates             -- liste des templates disponibles
```

### 5.2 Endpoints utilisateur (authentifiés)

```
POST /api/v1/me/parcours                  -- sauvegarder un parcours
GET  /api/v1/me/parcours
POST /api/v1/me/trames                    -- générer une trame
GET  /api/v1/me/trames/{id}/docx
GET  /api/v1/me/trames/{id}/pdf
POST /api/v1/me/trames/{id}/share         -- partager avec employeur
```

### 5.3 Endpoints négociateur

```
GET  /api/v1/cpnef/propositions           -- liste avec filtres
POST /api/v1/cpnef/propositions           -- créer
GET  /api/v1/cpnef/propositions/{id}
POST /api/v1/cpnef/propositions/{id}/validation
POST /api/v1/cpnef/propositions/{id}/withdraw
GET  /api/v1/cpnef/historique             -- toutes les modifications
GET  /api/v1/cpnef/usage                  -- analytics anonymisées
GET  /api/v1/cpnef/diff                   ?from_version=&to_version=
POST /api/v1/cpnef/export-deliberation    -- compile un PDF prêt CPNEF
```

### 5.4 Webhooks (sortants)

Pour les partenaires opt-in (OPCO Cohésion, Transitions Pro, France Travail, SIRH des structures adhérentes) :

```
referentiel.metier.created
referentiel.metier.updated
referentiel.metier.deprecated
referentiel.competence.created
referentiel.competence.updated
referentiel.passerelle.created
referentiel.grille.updated
trame.template.activated     -- bascule au 1er octobre 2026
```

Signature HMAC SHA-256 par secret partagé. Retry exponentiel avec dead-letter queue.

---

## 6. Stack technique recommandée

| Couche | Choix | Justification |
|--------|-------|---------------|
| Base de données | PostgreSQL 16 | Relationnel pour le coeur, JSONB pour la souplesse, mature, écosystème français de prestataires. |
| API | FastAPI (Python 3.12) | Async natif, OpenAPI gratuite, validation Pydantic, écosystème mature et largement déployé dans le secteur public et associatif. |
| Auth | Keycloak (OIDC) | OSS, multi-tenant, intégrable avec ESPACE adhérent. Alternative : Authentik. |
| File storage | S3-compatible (Scaleway / OVHcloud) | Hébergement français/européen, RGPD natif. |
| Cache | Redis 7 | Sessions, cache de lecture API, rate-limit. |
| Recherche full-text | PostgreSQL pg\_trgm | Suffisant pour 25 métiers et 16 compétences. Pas besoin d'Elasticsearch. |
| Génération PDF | WeasyPrint | OSS, bonne qualité, support CSS print, accessible. |
| Génération DOCX | python-docx + docxtpl | Templates Word reproductibles. |
| Frontend | Svelte 5 + Tailwind v4 | Bundle léger, cohérent avec le mockup, compatible WordPress en sous-page si besoin. |
| Hébergement | Scaleway (Paris) ou OVHcloud (Roubaix) | Souveraineté FR, certif ISO 27001. |
| CI/CD | GitHub Actions ou GitLab CI | Standard. |
| Observabilité | Prometheus + Grafana, Sentry | Standards de l'écosystème open-source, supervision technique et alerting. |

---

## 7. Workflow paritaire en pratique

Étape 1 — un négociateur (employeur ou salarié) ouvre une proposition de modification depuis le mode édition. Exemple : « ajouter la compétence "Communication numérique" au référentiel et l'intégrer aux fiches Animateur·trice et EJE au niveau 2 ».

Étape 2 — la proposition est notifiée aux autres négociateurs en place (par email + dans la file d'attente du portail).

Étape 3 — chaque négociateur peut donner un avis : `accord`, `refus`, `réserve`. Les avis sont signés et tracés.

Étape 4 — la fusion automatique intervient dès que la règle paritaire est satisfaite (cf. 3.3). En cas de désaccord persistant, la proposition est portée à l'ordre du jour de la séance plénière CPNEF, puis fermée selon le procès-verbal.

Étape 5 — la fusion déclenche les webhooks et l'invalidation des caches. Les fiches PDF actuellement servies sont régénérées dans la nuit.

Étape 6 — un export `compte-rendu de session` regroupe les propositions traitées sur une période donnée, pour annexion au procès-verbal.

---

## 8. Bascule réforme du 1er octobre 2026

La loi nº 2025-989 modifie l'article L6315-1. La bascule doit être prévue côté système.

- 1er mai 2026 — affichage en double dans les trames : ancienne et nouvelle terminologie.
- 1er juillet 2026 — flag `default_template` passe à la trame nouvelle dans le portail mais l'ancienne reste téléchargeable.
- 1er octobre 2026 — l'ancienne trame n'est plus proposée, redirection vers la nouvelle. Les trames anciennes déjà générées restent accessibles à leurs propriétaires.
- 1er décembre 2026 — communication CPNEF : taux de structures en conformité (basé sur les usages portail).

Ce calendrier est paramétrable par l'admin technique pour permettre un ajustement si besoin.

---

## 9. Métriques de suivi

Métriques techniques classiques (latence, disponibilité, erreurs) plus quatre métriques métier :

1. **Taux d'utilisation des trames** — nombre de trames générées par mois, par famille de métier.
2. **Taux de complétion des entretiens** — proportion de trames passées au statut `signed`.
3. **Top-10 des passerelles consultées** — utile à la CPNEF pour orienter les négociations.
4. **Délai moyen de fusion d'une proposition paritaire** — qualité du dialogue social.

Toutes ces métriques sont anonymisées (aucune donnée individuelle exposée). Restitution mensuelle automatique à la CPNEF.

---

## 10. Ce qui reste à arbitrer

Trois points à trancher avant le lancement.

**Hébergement** — solution mutualisée OPCO Cohésion ou hébergement propre ALISFA. Avantage de la mutualisation : maintenance partagée. Inconvénient : dépendance à un acteur extérieur sur un objet structurant pour la branche.

**Gouvernance technique** — le système est-il géré par une équipe interne ALISFA, par un prestataire au forfait ou par un consortium de branches similaires ? Recommandation : équipe interne réduite (2 ETP) avec prestataire en TMA, sur logiciel libre.

**Périmètre métier** — l'atlas peut s'étendre à d'autres référentiels (formation, fiche de poste type, fiche de risques professionnels). Décision à prendre par la CPNEF en fonction de la roadmap.
