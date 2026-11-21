# syntax=docker/dockerfile:1.7
# Huella Rosa production image: the Hono server serves /api and the built PWA from one origin.
# Build for the EC2 instance (Graviton): docker build --platform linux/arm64 -t huella-rosa .

ARG NODE_IMAGE=node:24-bookworm-slim

# ---- build: install the workspaces, generate Prisma, build the web app ----
FROM ${NODE_IMAGE} AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
# Production reads the SQLite path from DATABASE_URL (the dev schema pins file:./dev.db).
RUN sed -i 's|url *= *"file:./dev.db"|url      = env("DATABASE_URL")|' apps/server/prisma/schema.prisma \
  && grep -q 'env("DATABASE_URL")' apps/server/prisma/schema.prisma
ENV DATABASE_URL="file:/data/huella-rosa.db"
RUN npm ci --no-audit --no-fund
RUN npm run build -w @er/web && node apps/web/scripts/check-precache.mjs

# ---- runtime ----
FROM ${NODE_IMAGE} AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production \
    SERVE_WEB=1 \
    PORT=3001 \
    DATABASE_URL="file:/data/huella-rosa.db"
COPY --from=build --chown=node:node /app /app

# First start: apply migrations every time (idempotent), seed fictitious data only once.
COPY --chmod=755 <<'EOF' /usr/local/bin/huella-rosa-start
#!/bin/sh
set -e
cd /app/apps/server
npx prisma migrate deploy
if [ ! -f /data/.seeded ]; then
  echo "First start: loading fictitious demo data"
  npx tsx prisma/seed.ts
  touch /data/.seeded
fi
exec npx tsx src/index.ts
EOF

RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["huella-rosa-start"]
