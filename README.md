# Recomendação de filmes

MovieLens 100K + Postgres/pgvector + TensorFlow.js. Spec em `docs/superpowers/specs/`.

## Passo a passo

### 1. Docker Engine no WSL2 Ubuntu (uma vez)

Docker Engine no WSL2 Ubuntu; Docker Desktop com backend WSL2 também funciona.

    # uma vez, dentro do Ubuntu/WSL
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker $USER
    # no PowerShell: wsl --shutdown   (reabra o Ubuntu)

### 2. Clonar o projeto em `C:\dev\recomendacao-filmes`

Projeto no Windows: o Node roda aqui; o WSL2 encaminha a porta 5433 para localhost.

    # PowerShell, na pasta C:\dev
    git clone <url-do-repositório> recomendacao-filmes
    cd recomendacao-filmes

### 3. Criar o `.env`

    cp .env.example .env

Edite `PGPASSWORD` no `.env` antes de subir o banco.

### 4. Subir o banco (dentro do WSL)

O compose lê o `.env` criado no passo 3, por isso este passo vem depois dele.

    # dentro do WSL, na pasta do projeto
    cd /mnt/c/dev/recomendacao-filmes
    docker compose up -d

### 5. Instalar dependências

    npm install            # o postinstall (scripts/preparar-tfjs.js) cuida da tensorflow.dll no Windows

### 6. Baixar os dados

    npm run baixar-dados   # baixa e extrai o MovieLens 100K em data/ml-100k

### 7. Verificar o ambiente e rodar os testes

    npm run ambiente       # verifica TensorFlow.js e banco
    npm test

### 8. Análise exploratória

    npm run eda            # precisa dos dados (passo 6); só imprime no terminal, não grava arquivo

### 9. Carregar os filmes no banco (fase exp)

    npm run carregar-filmes   # precisa do banco (passo 4); grava artefatos/regua-exp.json e carrega public.filmes com a régua da fase exp

Não rode `npm run carregar-filmes -- --fase final` antes dos passos 10 a 12: eles exigem o banco carregado com a fase exp.

### 10. Verificar o HNSW

    npm run verificar-hnsw    # precisa do passo 9; grava resultados/verificacao-hnsw.json

### 11. Linha de base de popularidade

    npm run linha-de-base     # precisa dos dados e do passo 9 (régua); grava resultados/linha-de-base-validacao.json

### 12. Candidatos híbridos (populares + vizinhos)

    npm run candidatos        # precisa do banco carregado com a fase exp (passo 9); grava resultados/candidatos-validacao.json

### 13. Testes de integração

    npm run test:integracao   # precisa do banco; cria e remove os schemas teste_integracao e teste_busca (e teste_busca_vazio), sem tocar em public.filmes

Resultados versionados em `resultados/`: `verificacao-hnsw.json`, `linha-de-base-validacao.json`, `candidatos-validacao.json`.

### Reprodutibilidade do HNSW

A reprodutibilidade vale por construção do índice: o pgvector sorteia o nível dos nós ao construir o HNSW. Rodar de novo `verificar-hnsw` ou `candidatos` sobre a mesma carga dá resultados idênticos, mas depois de `npm run carregar-filmes` (que reconstrói o índice) os números baseados em HNSW podem mudar levemente. A busca exata e a linha de base não dependem disso.

## Ambiente

- Node: v22.23.3 (`.nvmrc` = 22, `engines` >=22 <23)
- Backend do TensorFlow.js: `tensorflow` (`@tensorflow/tfjs-node` 4.22.0)
- Treino de verificação (2 épocas, 1000x70): na ordem de centenas de ms
- Imagem do banco: `pgvector/pgvector:0.8.1-pg17` (tag confirmada com `docker pull`; digest `sha256:3e8b3adf...b700b21`)
- pgvector `extversion` medido: 0.8.1 (Postgres 17, via Docker no WSL2)

## Dados e citação

Os dados do MovieLens 100K não ficam no repositório. Citação:

F. Maxwell Harper and Joseph A. Konstan. 2015. The MovieLens Datasets: History and Context. ACM TiiS 5, 4, Article 19. DOI: 10.1145/2827872
