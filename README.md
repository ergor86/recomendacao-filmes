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

Resultados versionados em `resultados/`: `verificacao-hnsw.json`, `linha-de-base-validacao.json`, `candidatos-validacao.json` e, a partir do Plano 2, os arquivos de treino, comparação, grade, configuração final e `avaliacao-final.json`.

### Reprodutibilidade do HNSW

A reprodutibilidade vale por construção do índice: o pgvector sorteia o nível dos nós ao construir o HNSW. Rodar de novo `verificar-hnsw` ou `candidatos` sobre a mesma carga dá resultados idênticos, mas depois de `npm run carregar-filmes` (que reconstrói o índice) os números baseados em HNSW podem mudar levemente. A busca exata e a linha de base não dependem disso.

## Plano 2: treino da rede

### Treinar (`npm run treinar`)

    npm run gerar-candidatos -- --fase exp   # precisa do banco na fase exp; grava artefatos/candidatos-exp.json
    npm run treinar -- --fase exp --negativos uniforme|candidatos --arquitetura 128-64-32|64-32 [--sem-pop]

O script 09 não usa o banco nem lê o `u1.test`. Ele treina as sementes 1, 2 e 3. Para cada uma, grava o modelo em `modelos/<nome>-<fase>-s<semente>/` e atualiza `resultados/treino-<nome>-<fase>.json` (`nome` = `<negativos>-<arquitetura>[-sempop]`). Cada execução acrescenta uma linha em `resultados/diario-treinos.jsonl`. Na primeira execução de um `nome` numa fase, o motivo registrado é `planejado`. Se o diário já tem uma linha com o mesmo `nome` e a mesma fase, a execução é um retreino fora do plano: o script se recusa a começar (antes de montar os pares) sem `--motivo "<texto>"`. Use `--saida <pasta>` para rodar um teste de fumaça sem tocar em `modelos/`, `resultados/` e no diário, e `--max-epocas <n>` para trocar o teto de 50 épocas.

Na fase `exp`, o treino para sozinho: depois de 3 épocas sem melhora na perda de validação, ele restaura os pesos da melhor época. Na fase `final`, não há validação, então cada semente treina exatamente a melhor época que teve na `exp`:

    npm run treinar -- --fase final --negativos <...> --arquitetura <...> --epocas-de resultados/treino-<nome>-exp.json

### Por que o treino final usa épocas fixas (e o que isso significa)

O treino final usa o `u1.base` inteiro, sem esconder as notas da validação. Por isso ele tem cerca de 31% mais pares em cada época. Os números abaixo foram medidos com a semente 1 e o esquema uniforme. A contagem de pares é a mesma nos dois esquemas e em todas as sementes, porque o sorteio muda quais filmes entram, mas não quantos.

| Fase | Notas no treino | Pares de treino | Positivos | Sorteados (4 por positivo) | Observados (nota 1–3) | Passos de gradiente por época (lote 256) |
|---|---|---|---|---|---|---|
| `exp` | 61.012 | 195.847 | 33.709 | 134.836 | 27.302 | 766 |
| `final` | 80.000 | 256.555 | 44.139 | 176.556 | 35.860 | 1.003 (+31%) |

Repetir na fase final o mesmo número de épocas da `exp` dá cerca de 31% mais passos de gradiente. Ou seja, a rede final treina um pouco mais do que a rede escolhida na validação. A alternativa seria fixar o número de passos, mas aí a rede veria cada exemplo menos vezes. O plano fixa as épocas e registra `passosDeGradiente` em cada `treino-*.json`, para que a diferença fique visível.

## Avaliação final no `u1.test` (feita uma única vez, em 2026-11-12)

A configuração foi congelada em `resultados/configuracao-final.json` antes de qualquer contato com o teste: negativos dos candidatos, arquitetura 64→32, K = 150 populares e N = 0 vizinhos. O modelo é `candidatos-64-32` e o controle sem popularidade é `candidatos-64-32-sempop`. A sequência rodada foi esta:

    npm run carregar-filmes -- --fase final      # régua-final (hash b994e671…) e recarga do banco
    npm run gerar-candidatos -- --fase final     # 943 usuários; populares 200/200; vizinhos 0/100 (1 usuário sem vizinhos)
    npm run treinar -- --fase final --negativos candidatos --arquitetura 64-32 --epocas-de resultados/treino-candidatos-64-32-exp.json
    npm run treinar -- --fase final --negativos candidatos --arquitetura 64-32 --sem-pop --epocas-de resultados/treino-candidatos-64-32-sempop-exp.json
    npm run avaliacao-final                      # uma vez; grava resultados/avaliacao-final.json e se recusa a sobrescrevê-lo

Cada semente treinou exatamente a melhor época que teve na validação: o modelo treinou 11, 15 e 15 épocas, e o controle 15, 15 e 16. O script 13 rodou uma única vez, sem erro, e não foi preciso rodá-lo de novo. Depois disso, o banco fica carregado com a régua da fase `final`: para voltar a rodar os scripts da fase `exp` (passos 10 a 12), rode antes `npm run carregar-filmes`.

### Resultado principal

São 456 usuários avaliados: os 459 do `u1.test` menos 446, 459 e 460, que não têm nenhum relevante.

| | NDCG@10 |
|---|---|
| Exp. 4: híbrido + rede (média das 3 sementes) | **0,3526** |
| Exp. 1: popularidade | 0,2451 |
| Diferença média por usuário (Exp. 4 − Exp. 1) | **+0,1076** |
| Intervalo de confiança de 95% (bootstrap pareado, 5.000 reamostragens, semente 2026) | [0,0907; 0,1250] |

O intervalo não inclui o zero, então **a hipótese principal é suportada**: no `u1.test`, o híbrido com rede superou a popularidade em NDCG@10. A tabela dos 7 experimentos, a análise mainstream × nicho e as limitações estão em [`resultados/README.md`](resultados/README.md#avaliacao-finaljson).

**Atenção:** a busca vetorial **não** entrou no sistema escolhido. Na grade da validação, N = 0 (nenhum vizinho) teve o maior NDCG, e o sistema avaliado usa só os 150 populares. O ganho vem da rede reordenando os populares, e não dos vetores (detalhes em `resultados/README.md`).

## Ambiente

- Node: v22.23.3 (`.nvmrc` = 22, `engines` >=22 <23)
- Backend do TensorFlow.js: `tensorflow` (`@tensorflow/tfjs-node` 4.22.0)
- Treino de verificação (2 épocas, 1000x70): na ordem de centenas de ms
- Imagem do banco: `pgvector/pgvector:0.8.1-pg17` (tag confirmada com `docker pull`; digest `sha256:3e8b3adf...b700b21`)
- pgvector `extversion` medido: 0.8.1 (Postgres 17, via Docker no WSL2)

## Dados e citação

Os dados do MovieLens 100K não ficam no repositório. Citação:

F. Maxwell Harper and Joseph A. Konstan. 2015. The MovieLens Datasets: History and Context. ACM TiiS 5, 4, Article 19. DOI: 10.1145/2827872
