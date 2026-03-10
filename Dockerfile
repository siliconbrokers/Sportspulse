FROM node:22-alpine

RUN npm install -g pnpm

WORKDIR /app

# Instalar dependencias (solo manifests primero para cache)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json       ./packages/shared/
COPY packages/canonical/package.json    ./packages/canonical/
COPY packages/signals/package.json      ./packages/signals/
COPY packages/scoring/package.json      ./packages/scoring/
COPY packages/layout/package.json       ./packages/layout/
COPY packages/snapshot/package.json     ./packages/snapshot/
COPY packages/api/package.json          ./packages/api/
COPY packages/web/package.json          ./packages/web/
COPY packages/prediction/package.json  ./packages/prediction/

RUN pnpm install --frozen-lockfile

# Copiar todas las fuentes
COPY tsconfig*.json ./
COPY packages/shared      ./packages/shared
COPY packages/canonical   ./packages/canonical
COPY packages/signals     ./packages/signals
COPY packages/scoring     ./packages/scoring
COPY packages/layout      ./packages/layout
COPY packages/snapshot    ./packages/snapshot
COPY packages/api         ./packages/api
COPY packages/web         ./packages/web
COPY packages/prediction  ./packages/prediction
COPY server             ./server
COPY radar_docs         ./radar_docs

# Compilar todo (backend + frontend)
RUN pnpm -r build

EXPOSE 3000

CMD ["pnpm", "start"]
