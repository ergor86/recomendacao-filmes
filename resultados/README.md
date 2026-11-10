# Resultados

Os arquivos desta pasta são gerados pelos scripts e versionados, para que os números citados na documentação possam ser conferidos. JSON não aceita comentários, então a explicação de cada campo fica aqui.

Todos foram gerados na **fase `exp`** (validação), ou seja, nos usuários 463 a 943 com 40% das notas de cada um escondidas (semente 42). O teste oficial (`u1.test`) ainda não foi usado.

## Conceitos usados em todos os arquivos

- **Relevante:** um filme escondido que o usuário avaliou com nota ≥ 4. O conjunto de relevantes de cada usuário é o **gabarito**.
- **Usuários avaliados:** só entram nas médias os usuários com pelo menos um relevante escondido (478 na validação). Os usuários 685, 797 e 814 ficam de fora porque não têm nenhum.
- **`hashRegua`:** impressão digital (sha256) da régua usada. Dois arquivos com o mesmo hash foram gerados com os mesmos parâmetros de codificação.
- **`fase`:** `exp` (validação) ou `final` (teste).
- **Médias por usuário:** cada métrica é calculada para cada usuário e depois tirada a média simples. Um usuário com 3 relevantes pesa o mesmo que um com 50.

## `linha-de-base-validacao.json`

**Gerado por:** `npm run linha-de-base` (script 06).

O sistema mais simples que faz sentido: recomendar a cada usuário os 10 filmes mais populares que ele ainda não viu. É o número que a rede neural precisa superar.

| Campo | Valor | O que significa |
|---|---|---|
| `ndcg` | 0,2330 | **NDCG@10**, a métrica principal. Como a precisão, mas um acerto vale mais quanto mais alto estiver na lista (1ª posição vale 1; 10ª vale 0,29). Vai de 0 a 1. |
| `precisao` | 0,2021 | **Precisão@10.** Dos 10 recomendados, a fração que era relevante. Em média, 2 acertos em 10. |
| `recall` | 0,1206 | **Recall@10.** Dos relevantes escondidos, a fração que apareceu no top 10. É baixo porque muitos usuários têm dezenas de relevantes e só há 10 vagas. |
| `cobertura` | 0,0184 | Fração dos 1682 filmes que aparece em alguma lista: só 31 filmes. Esperado, porque todos recebem quase a mesma lista de populares. |
| `popularidadeMediaContagem` | 282,6 | Média do nº de notas no treino dos filmes recomendados. Mede o viés para populares; servirá de comparação para a rede. |
| `nUsuarios` | 478 | Usuários avaliados. |
| `semente` | 42 | Semente das notas escondidas. |

**Leitura:** 0,233 parece pouco, mas é uma linha de base forte. No MovieLens, as pessoas assistem e gostam muito dos mesmos clássicos.

## `candidatos-validacao.json`

**Gerado por:** `npm run candidatos` (script 07).

Mede a primeira etapa do sistema: a lista de candidatos que a rede vai ordenar.

### Recall dos candidatos

A métrica principal deste arquivo. Para cada usuário, é a fração dos relevantes escondidos que entrou na lista de candidatos. A média é feita sobre os usuários.

É o **teto** do sistema: a rede só ordena o que recebe, então um relevante que não entrou nos candidatos nunca será recomendado.

### Campos

| Campo | O que significa |
|---|---|
| `populares.K50` … `K200` | Recall usando só os K populares não vistos. Com K = 100: **0,462**. |
| `vetorial.N20` … `N100` | Recall usando só os N vizinhos mais próximos do perfil do usuário no pgvector. Com N = 100: **0,199**. |
| `grade` | Uma linha para cada combinação de K (50, 100, 150, 200) e N (0, 20, 50, 100). Os campos de cada linha estão abaixo. |
| `grade[].recallUniao` | Recall da união das duas listas, sem repetição. |
| `grade[].orcamentoEfetivo` | Tamanho médio da lista após a união. Fica abaixo de K + N porque alguns vizinhos também são populares e contam uma vez só. |
| `grade[].contribuicaoExclusiva` | Dos acertos da união, a fração que **só** a fonte vetorial trouxe. Soma os acertos de todos os usuários antes de dividir (agregada), em vez de fazer a média das frações por usuário. |
| `nUsuariosComVetor` | Usuários com perfil vetorial (têm pelo menos uma curtida no treino): 478. |
| `exp2` | Experimento 2: recomendar só os 10 vizinhos mais próximos, sem popularidade. NDCG **0,070**, P@10 0,061, R@10 0,032. |
| `definicoes` | As mesmas definições, gravadas dentro do arquivo. |
| `reprodutibilidade` | Ver a seção do HNSW abaixo. |

### A grade K × N

| K \ N | 0 | 20 | 50 | 100 |
|---|---|---|---|---|
| **50** | 0,323 · 50 | 0,364 · 68 | 0,405 · 97 | 0,462 · 144 |
| **100** | 0,462 · 100 | 0,491 · 117 | 0,523 · 144 | **0,567 · 189** |
| **150** | 0,577 · 150 | 0,600 · 165 | 0,622 · 191 | 0,656 · 234 |
| **200** | 0,647 · 200 | 0,665 · 213 | 0,683 · 238 | 0,712 · 279 |

Cada célula mostra o recall da união e o tamanho médio da lista.

### Leitura

- **Vetores sozinhos são fracos.** Como recomendador, ficam em NDCG 0,070, contra 0,233 da popularidade. Gênero e época dizem "que tipo de filme", mas não "se é bom".
- **Na união, os vetores acrescentam recall:** com K = 100, sair de N = 0 para N = 100 leva o recall de 0,462 a 0,567. Com K = 100 e N = 100, 16,5% dos acertos vieram só dos vetores.
- **Com o mesmo tamanho de lista, mais populares rendem mais recall do que vetores.** Por exemplo, K = 150 sem vetores (150 candidatos) dá 0,577, contra 0,523 de K = 100 com N = 50 (144 candidatos). O valor dos vetores para a rede ainda precisa ser medido no Plano 2: eles trazem filmes diferentes, mas não necessariamente mais acertos.

## `verificacao-hnsw.json`

**Gerado por:** `npm run verificar-hnsw` (script 05).

O índice HNSW acha vizinhos rápido, mas de forma aproximada. Este arquivo mede quanto ele concorda com a busca exata, que compara o usuário com todos os filmes.

| Campo | Valor | O que significa |
|---|---|---|
| `fracaoMedia` | 0,9958 / 0,9976 / 0,9982 | Para N = 20 / 50 / 100: dos N vizinhos da busca exata, a fração que o HNSW também devolveu, em média por usuário. Acima de 0,99 é considerado seguro. |
| `nUsuarios` | 480 | Usuários de validação com perfil (pelo menos uma curtida no treino). São 480, e não 478, porque aqui não é preciso ter relevantes escondidos. |
| `parametros.ef_search` | 40 | Piso do ef_search, ou seja, de quantos candidatos o HNSW explora por consulta. |
| `efSearchPorN` | 70 / 100 / 150 | ef_search efetivamente usado para cada N. É N + 50 linhas pedidas, com mínimo de 40. |
| `regraEfSearch` | | A regra acima, por extenso. |
| `parametros.iterative_scan` | strict_order | Se o filtro "já vistos" remover linhas demais, o índice continua buscando, mantendo a ordem por distância. |
| `parametros.max_scan_tuples`, `scan_mem_multiplier` | 20000, 1 | Limites da varredura iterativa (padrões do pgvector 0.8.1). |
| `reprodutibilidade` | | Os números se repetem exatamente enquanto o índice não é reconstruído. |

**Leitura:** o HNSW perde menos de 1 vizinho em 200. Dá para usar o índice rápido sem distorcer os resultados.

**Sobre a reprodutibilidade:** o pgvector sorteia a estrutura do grafo ao construir o índice. Recarregar o banco (`npm run carregar-filmes`) reconstrói o grafo, e os números deste arquivo e de `candidatos-validacao.json` podem mudar na 3ª ou 4ª casa decimal. Rodar os scripts de novo sem recarregar dá exatamente os mesmos números.
