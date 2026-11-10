# Recomendação de filmes

MovieLens 100K + Postgres/pgvector + TensorFlow.js. Spec em `docs/superpowers/specs/`.

## Passo a passo

    git clone <url-do-repositório> recomendacao-filmes
    cd recomendacao-filmes
    cp .env.example .env
    docker compose up -d
    npm install            # o postinstall (scripts/preparar-tfjs.js) cuida da tensorflow.dll no Windows
    npm run baixar-dados   # Task 2
    npm run ambiente       # verifica TensorFlow.js e banco
    npm test

Demais scripts: `eda`, `carregar-filmes`, `verificar-hnsw`, `linha-de-base`, `candidatos` (ver `package.json`).

## Ambiente

- Node: v22.23.3 (`.nvmrc` = 22, `engines` >=22 <23)
- Backend do TensorFlow.js: `tensorflow` (`@tensorflow/tfjs-node` 4.22.0)
- Treino de verificação (2 épocas, 1000x70): na ordem de centenas de ms
- Imagem do banco: `pgvector/pgvector:0.8.1-pg17` (tag NÃO confirmada com `docker pull`)
- Verificação do banco pendente: Docker não instalado

## Dados e citação

Os dados do MovieLens 100K não ficam no repositório. Citação:

F. Maxwell Harper and Joseph A. Konstan. 2015. The MovieLens Datasets: History and Context. ACM TiiS 5, 4, Article 19. DOI: 10.1145/2827872
