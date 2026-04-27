# Atlas des métiers ALISFA

Mockup HTML interactif du référentiel **métiers et compétences** de la branche professionnelle ALISFA (CPNEF), avec mode édition paritaire et passerelles entre métiers.

> ⚠️ Mockup à des fins de présentation et de discussion — pas un système de production.
> La documentation d'architecture pour le passage à un système vivant et paritaire
> se trouve dans [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Contenu

- **`index.html`** — mockup statique autonome (HTML + CSS + JS embarqués, ~170 KB)
- **`ARCHITECTURE.md`** — document d'architecture pour le backend cible
- **`Dockerfile`** + **`nginx.conf`** — image conteneurisée optimisée (gzip, cache, sécurité)
- **`docker-compose.yml`** — démarrage local en une commande
- **`.github/workflows/pages.yml`** — déploiement automatique sur GitHub Pages

## Démarrage local

### Sans Docker (le plus rapide)

```bash
# Python
python3 -m http.server 8088
# puis http://localhost:8088
```

### Avec Docker

```bash
docker compose up -d
# puis http://localhost:8088
```

L'image nginx-alpine fait ~25 MB et sert le HTML pré-compressé en gzip.

## Déploiement gratuit

Trois options testées, classées par simplicité :

### Option A — GitHub Pages (recommandé, intégré au repo)

```bash
gh repo create atlas-metiers-alisfa --public --source=. --push
gh api -X POST /repos/:owner/atlas-metiers-alisfa/pages -f build_type=workflow
```

L'URL sera `https://VOTRE_USER.github.io/atlas-metiers-alisfa/`.
Le workflow `.github/workflows/pages.yml` redéploie à chaque push sur `main`.

### Option B — Cloudflare Pages

```bash
npx wrangler pages deploy . --project-name=atlas-metiers-alisfa
```

URL en `*.pages.dev`.

### Option C — Surge.sh (le plus rapide)

```bash
npx surge . atlas-metiers-alisfa.surge.sh
```

URL personnalisée immédiate, pas de compte GitHub requis.

## Optimisations de vitesse en place

- **Gzip pré-compressé** au build de l'image (gain ~75% sur le HTML).
- **Cache long** sur les assets statiques (`max-age=1 an, immutable`).
- **Cache court** sur le HTML (5 min) pour permettre les mises à jour rapides.
- **Healthcheck** Docker pour redémarrage auto en cas de problème.

## Sécurité (headers nginx)

| Header | Valeur |
|---|---|
| `Content-Security-Policy` | strict, autorise uniquement self + inline (mockup) |
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera/micro/geo bloqués |

## Mentions

- Référentiel inspiré des fiches métiers CPNEF ALISFA.
- Mention « ELISFA » conservée dans le code uniquement comme `auteurOrg`
  des propositions paritaires côté collège employeur — c'est l'affiliation
  légitime des négociateurs employeur en CPNEF ALISFA.
