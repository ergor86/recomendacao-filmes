# Recomendação de filmes

MovieLens 100K + Postgres/pgvector + TensorFlow.js. Spec em `docs/superpowers/specs/`.

## Passo a passo

Banco (Docker Engine no WSL2 Ubuntu; Docker Desktop com backend WSL2 também funciona):

    # uma vez, dentro do Ubuntu/WSL
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker $USER
    # no PowerShell: wsl --shutdown   (reabra o Ubuntu)

    # dentro do WSL, na pasta do projeto
    cd /mnt/c/dev/recomendacao-filmes
    docker compose up -d

Projeto (Windows, o Node roda aqui; o WSL2 encaminha a porta 5433 para localhost):

    git clone <url-do-repositório> recomendacao-filmes
    cd recomendacao-filmes
    cp .env.example .env
    npm install            # o postinstall (scripts/preparar-tfjs.js) cuida da tensorflow.dll no Windows
    npm run baixar-dados   # Task 2
    npm run ambiente       # verifica TensorFlow.js e banco
    npm test

Demais scripts: `eda`, `carregar-filmes`, `verificar-hnsw`, `linha-de-base`, `candidatos` (ver `package.json`).

## Ambiente

- Node: v22.23.3 (`.nvmrc` = 22, `engines` >=22 <23)
- Backend do TensorFlow.js: `tensorflow` (`@tensorflow/tfjs-node` 4.22.0)
- Treino de verificação (2 épocas, 1000x70): na ordem de centenas de ms
- Imagem do banco: `pgvector/pgvector:0.8.1-pg17` (tag confirmada com `docker pull`; digest `sha256:3e8b3adf...b700b21`)
- pgvector `extversion` medido: 0.8.1 (Postgres 17, via Docker no WSL2)

## Dados e citação

Os dados do MovieLens 100K não ficam no repositório. Citação:

F. Maxwell Harper and Joseph A. Konstan. 2015. The MovieLens Datasets: History and Context. ACM TiiS 5, 4, Article 19. DOI: 10.1145/2827872
