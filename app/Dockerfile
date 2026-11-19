# Imagem única da aplicação (spec 4.1): serve o `preparar` e o `app`. Alpine é proibido (musl).
# Base: índice multiarquitetura (amd64 + arm64) de node:22-bookworm-slim, fixado em 2026-11-19 por
# `docker buildx imagetools inspect node:22-bookworm-slim`. Para atualizar, repita o comando e troque o digest.
# Contexto de build: a RAIZ do repositório (docker build -f app/Dockerfile .); o .dockerignore é lista de permissão.

# ---- estágio web: compila o frontend (Vite) ----
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS web
WORKDIR /repo/app/web
COPY app/web/package.json app/web/package-lock.json ./
RUN npm ci
COPY app/web/index.html app/web/vite.config.js ./
COPY app/web/public ./public
COPY app/web/src ./src
RUN npm run build

# ---- estágio de execução ----
FROM node:22-bookworm-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
ENV NODE_ENV=production
WORKDIR /repo

# raiz: só o que o script 16 e a busca precisam; o TF.js não é usado em execução (o teste de isolamento garante)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && rm -rf node_modules/@tensorflow && npm cache clean --force
COPY src ./src
COPY scripts ./scripts

# app/
COPY app/package.json app/package-lock.json ./app/
RUN cd app && npm ci --omit=dev && npm cache clean --force
COPY app/integridade.js ./app/integridade.js
COPY app/banco ./app/banco
COPY app/comum ./app/comum
COPY app/preparar ./app/preparar
COPY app/servidor ./app/servidor
COPY --from=web /repo/app/web/dist ./app/web/dist

# diretórios dos volumes, com dono node ANTES de trocar de usuário (volumes novos herdam o dono)
RUN mkdir -p /var/app/dados /var/app/trabalho /var/app/estado && chown -R node:node /var/app
USER node
EXPOSE 3000
CMD ["node", "app/servidor/index.js"]
