# Atlas des métiers ALISFA — image statique
# Image légère (~25 MB), sert le mockup HTML compressé avec gzip
FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="Atlas Métiers ALISFA" \
      org.opencontainers.image.description="Mockup HTML statique du référentiel métiers et compétences ALISFA (CPNEF)" \
      org.opencontainers.image.source="https://github.com/" \
      org.opencontainers.image.licenses="Proprietary"

# Configuration nginx optimisée (gzip, cache, headers de sécurité)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Contenu statique
COPY index.html /usr/share/nginx/html/index.html
COPY ARCHITECTURE.md /usr/share/nginx/html/ARCHITECTURE.md

# Pré-compression gzip pour gain de bande passante
RUN gzip -k -9 /usr/share/nginx/html/index.html \
    && gzip -k -9 /usr/share/nginx/html/ARCHITECTURE.md

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost/ || exit 1

EXPOSE 80
