# Aplicação local sobre a S1 — Etapa 1 (MVP) — Design

Data: 2026-11-16. Status: rascunho para revisão crítica. Nada implementado.

## 1. Intenção

Transformar o resultado do Plano 3 numa aplicação que qualquer pessoa consiga rodar no próprio computador. Nela, a pessoa:

- cria um perfil;
- indica alguns filmes de que gosta;
- avalia filmes do catálogo do MovieLens 100K;
- recebe na hora um top 10 calculado pela **S1** (filtragem colaborativa item-item com busca HNSW), exatamente o sistema escolhido e congelado no Plano 3.

O projeto é acadêmico (pós-graduação, unidade de Deep Learning e Sistemas de Recomendação) e de portfólio: código público no GitHub, divulgado no LinkedIn, sem hospedagem permanente. O público da aplicação são pessoas que **não conhecem o projeto**, então a instalação e a interface precisam ser simples, e os limites científicos precisam aparecer com clareza.

### 1.1 Objetivos da etapa 1
1. Perfis locais, onboarding opcional, catálogo pesquisável, avaliação de 1 a 5 estrelas com edição e exclusão, sinais "Já assisti e gostei" e "Quero assistir", e a lista pessoal "Quero assistir".
2. Top 10 pela S1, recalculado a cada pedido, sem botão de treino.
3. Estatísticas por filme em fontes **separadas**: o histórico do MovieLens (treino `v2-final`), as notas desta instalação e a nota da própria pessoa.
4. Cartaz **gerado localmente** como comportamento padrão. A arquitetura de mídia já fica pronta para um fornecedor externo autorizado, sem refatorar o frontend nem o recomendador.
5. Instalação limpa com Docker Compose, sem credenciais de serviços externos e sem arquivos privados do ambiente de desenvolvimento.

### 1.2 Fora do escopo da etapa 1
- Fornecedor externo de cartazes ou sinopses: TMDB ou outro, condicionado à confirmação jurídica (§11).
- Mapeamento entre MovieLens, IMDb e TMDB (etapa 2, com os requisitos da §11.2).
- Relatório exploratório de cold start (etapa 2).
- Feedback negativo (etapa 3), que será uma extensão separada, com a S1 preservada como referência.
- Reconstrução dos vetores, retreino, novas técnicas de recomendação, uso de demografia, site público, contas com senha e acesso pela rede.

### 1.3 Anti-objetivos (falham o projeto mesmo que "funcione")
- Alterar qualquer artefato congelado da pesquisa: `src/`, `scripts/`, `package.json`, `package-lock.json` da raiz e `resultados/*.json`. Também é falha a aplicação deixar arquivos não rastreados que quebrem a conferência de congelamento da etapa 2 (`git status` limpo).
- Ler o gabarito: o `u1.test`, ou o teste-2 com `incluirTeste2`. Também é falha rodar qualquer experimento novo sobre o teste-2.
- Apresentar a qualidade medida no teste-2 como qualidade para usuários novos da aplicação.
- Trocar a S1 por outro mecanismo sem avisar. A busca exata só existe na rota de diagnóstico.
- Redistribuir pelo repositório os dados do MovieLens, cartazes protegidos ou sinopses de terceiros.
- Exigir uma chave pessoal de serviço externo para instalar ou usar.
- Fazer o catálogo ou as recomendações dependerem de imagens externas.

## 2. Restrições herdadas (verificadas no código em 2026-11-16)

- **Banco:** Postgres 17 com pgvector 0.8.1 (`pgvector/pgvector:0.8.1-pg17`).
  - O script congelado `scripts/16-carregar-v2.js --fase v2-final` cria o schema `v2_final` com:
    - `filmes(id, titulo, ano, embedding)`, com os vetores de conteúdo;
    - `filmes_fc(id, embedding vector(943))`, com índice HNSW de cosseno: são 1.385 filmes, e 297 ficam sem vetor;
    - `metadados(chave, valor)`, com `hash_regua` e `hash_treino`.
  - O script também grava `artefatos/regua-v2-final.json`. Ele **não importa o TF.js**: só `src/modelo/rede.js` importa.
- **Hashes congelados** em `resultados/configuracao-v2.json` → `hashes`:
  - `regua` = `12119b16…521a`;
  - `treino` = `ac6c0eac…377a`;
  - `vetoresFC` = `08325f42…4861`;
  - o hash do teste-2, que a aplicação nunca usa.
- **Busca:** `buscarColaborativos(pool, { vetor, excluir, m, hashes:{regua,treino}, modo })` em `src/banco/busca-fc.js`.
  - Aceita m ≤ 300 e pede m + 50 linhas, por isso o `ef_search` depende de m.
  - Confere os hashes do banco dentro de uma transação REPEATABLE READ.
  - Usa `current_schema()` e precisa de `search_path=v2_final,public`.
- **Perfil:** `perfilFC(fc, curtidos)` devolve `null` quando nenhum curtido tem vetor, e `vetorDeBusca(null)` lança erro.
  - `fc = { nUsuarios, fasPorFilme }`.
  - `hashVetoresFC(fc)` faz o hash de `{ filme: fãs ordenados }`.
- **Popularidade:** `regua.contagens` (número de notas por filme no treino `v2-final`), ordenada por `rankingPopularidade` (contagem decrescente, depois id crescente).
- **Dados:** `src/dados/carregar.js` lê `u1.base`, `u.item` e `u.user`, e o `u1.test` só com `incluirTeste`. Para a fase `v2-final`, `criarContexto` retira o teste-2 do treino.
- **Raiz:** o `package.json` traz `@tensorflow/tfjs-node` e um `postinstall` que prepara o TF.js. Os módulos de `src/` resolvem `pg` pelo `node_modules` da raiz.
- **Isolamento:** `tests/unidade/isolamento-estatico.test.js` varre só `src/` e `scripts/`.
- **Congelamento:** `conferirCongelamento` exige `git diff --quiet c048537 HEAD -- src scripts package.json package-lock.json` e uma árvore limpa.
- **Licenças:**
  - MovieLens: sem redistribuição e sem uso comercial; citar Harper & Konstan (2015).
  - Cinemeta/MetaHub: **descartados**. Os termos restringem o uso ao Stremio, e o MetaHub declara que a licença não autoriza exibir imagens. Ver os relatórios da prova de conceito de 2026-11-15.

## 3. Abordagens consideradas

| Abordagem | Como funciona | Troca |
|---|---|---|
| **A. App em `app/`, que importa os módulos congelados só para leitura, e um Compose próprio com `db`, `preparar` e `app`** (escolhida) | O serviço `preparar` roda o script 16 sem alteração e calcula as tabelas da aplicação. O `app` importa `buscarColaborativos`, `perfilFC`, `vetorDeBusca` e `hashVetoresFC` sem copiá-los. | Reaproveita exatamente o código avaliado. Exige cuidado com dependências (o TF.js na raiz) e com permissões no banco. |
| B. Copiar a lógica da S1 para dentro de `app/` | Independência total da raiz. | Duas implementações da S1 podem divergir sem ninguém notar. Contraria "não modificar a S1". |
| C. Pré-calcular top 10 para perfis fixos | Simples. | Não atende "atualizado na hora" nem usuários novos. |

O usuário aprovou a opção A dos vetores (congelados, só leitura) e a pasta `app/` separada.

## 4. Arquitetura

```
                    docker compose (projeto "recomendacao-app", pasta app/)
┌──────────┐   ┌────────────────────────────────┐   ┌───────────────────────────────┐
│ db       │◄──│ preparar (roda uma vez)        │   │ app (Node 22)                 │
│ pgvector │   │ 1 baixa ML-100K + MD5 fixo     │   │ API HTTP + frontend estático  │
│ sem porta│   │ 2 node scripts/16 --fase       │   │ 127.0.0.1:3000                │
│ no host  │   │   v2-final (congelado)         │   │ confere hashes ao iniciar     │
│          │   │ 3 confere hashes × config      │   │ pool leitura: v2_final + app  │
│          │◄──│ 4 migrações do schema app      │   │ pool escrita: só app.perfil/  │
│          │   │ 5 papéis do banco              │   │   app.interacao               │
│          │   │ 6 catálogo, estatísticas,      │   │                               │
│          │◄──┼─────────────────── gêmeos ─────┘   └──────────────┬────────────────┘
└──────────┘                                                      │ depends_on: preparar
                                                                  ▼  concluído com sucesso
                                                         navegador (React)
```

### 4.1 Serviços
- **db:** a imagem `pgvector/pgvector:0.8.1-pg17`, com o mesmo digest do `docker-compose.yml` da raiz. Usa um volume próprio (`app_dados_pg`) e **não publica porta no host**. A aplicação não toca no banco da pesquisa: o Compose é outro projeto, com outro volume.
- **preparar:** imagem construída da raiz do repositório, com o contexto em `..`.
  - Instala as dependências da raiz com `npm ci --ignore-scripts`. Isso pula o `postinstall` do TF.js e o download nativo; como nada desse caminho importa o TF.js, ele nunca é carregado. Instala também as dependências próprias de `app/`.
  - Roda `node app/preparar/index.js`, que é **idempotente**:
    1. Se o volume de dados já tiver `u.item` e `u1.base` e o banco já tiver `v2_final` e `app` com hashes corretos, só confere e sai com sucesso.
    2. Senão, baixa `https://files.grouplens.org/datasets/movielens/ml-100k.zip`, confere o **MD5 fixo no código** e extrai num volume (`app_dados_ml`), nunca na árvore do repositório. O MD5 vem de `.md5` publicado pela GroupLens, conferido pelo desenvolvedor contra o download atual e registrado como constante, com a data. Ele não é baixado do mesmo servidor a cada instalação. As funções `md5Hex` e `conferirMd5` vêm de `src/dados/download.js`.
    3. Roda `node scripts/16-carregar-v2.js --fase v2-final` como subprocesso, sem alteração, com `DIR_DADOS` apontando para o volume. O `artefatos/` também fica num volume, para a árvore de quem desenvolve nunca mudar.
    4. Confere se `v2_final.metadados` tem `hash_regua` e `hash_treino` iguais aos de `resultados/configuracao-v2.json`. Reconstrói `fc` a partir de `filmes_fc` (fãs = posições não nulas + 1) e confere `hashVetoresFC(fc) === hashes.vetoresFC`. **Se qualquer conferência falhar, sai com erro e explica a causa.**
    5. Aplica as migrações SQL de `app/banco/migracoes/` em ordem, registradas em `app.migracao`.
    6. Cria ou atualiza os papéis do banco (§5.2).
    7. Preenche as tabelas de referência: `app.filme`, `app.estatistica_historica` e `app.filme_gemeo` (§5.1). As estatísticas vêm de `criarContexto({ fase: 'v2-final', dirDados })`, **sem `incluirTeste2`**, e gravam o hash do treino usado.
  - Escreve um resumo legível no log: hashes conferidos, quantos filmes, quantos com vetor e o tempo gasto.
- **app:** a mesma imagem com outro comando, `node app/servidor/index.js`.
  - Sobe só depois de `preparar` terminar com sucesso (`depends_on: condition: service_completed_successfully`).
  - Publica `127.0.0.1:${APP_PORTA:-3000}:3000`, só no localhost.
  - Serve a API em `/api` e o frontend já compilado (multi-stage build com Vite) em `/`.

### 4.2 Conferência ao iniciar (`app`)
Antes de aceitar pedidos, o servidor:
- lê `resultados/configuracao-v2.json` (só leitura);
- confere os hashes de régua e de treino no banco;
- reconstrói `fc` a partir de `v2_final.filmes_fc` e confere `hashVetoresFC`;
- confere se `app.estatistica_historica` foi gerada com o `hash_treino` congelado.

Se algo não bater, o servidor **sobe em modo bloqueado**: todas as rotas `/api/*`, exceto `/api/saude` e `/api/sobre`, respondem `503 { codigo: 'BANCO_NAO_CONFERE', detalhe }`, e o frontend mostra uma página com a causa e o comando para refazer a preparação. O motivo de não simplesmente encerrar o processo é que, para um leigo, uma página explicativa é melhor do que um contêiner reiniciando em loop.

O `fc` reconstruído fica em memória, em `fasPorFilme` com 1.385 entradas, e é a mesma estrutura que `construirFC` produziria a partir do treino. A aplicação **não** lê o treino em tempo de execução.

### 4.3 Pipeline de recomendação (S1, sem mudanças)
Para um perfil P:
1. `interagidos(P)` = todos os filmes com qualquer interação de P: nota, gostei ou quero assistir.
2. `curtidos(P)` = filmes com `gostei` ∪ filmes com nota 4 ou 5.
3. `excluir` = `interagidos(P)` ∪ os gêmeos dos interagidos (§5.1) ∪ `{267}` (o registro "unknown"), ordenado.
4. `perfil = perfilFC(fc, curtidos)`:
   - se `curtidos` estiver vazio → `motivo = 'sem_curtidas'`, e a lista vem só de populares;
   - se `perfil === null` com curtidos não vazios → `motivo = 'curtidas_sem_vetor'`, também só populares, com a explicação de que nenhum desses filmes foi curtido na amostra histórica.
5. Caso contrário, `vetor = vetorDeBusca(perfil)` e `buscarColaborativos(poolLeitura, { vetor, excluir, m: 150, hashes: { regua, treino }, modo: 'hnsw' })`.
   - **m = 150 e modo `'hnsw'` são constantes no código**, iguais à avaliação (FC150): nenhum parâmetro da requisição altera esses valores.
   - Ficam os 10 primeiros resultados, com `fonte: 'S1'`.
   - Os gêmeos de filmes já presentes na lista também saem, e a lista avança.
6. Se faltarem itens, a lista é completada com populares: a ordem de `estatistica_historica.n_notas` decrescente, depois id crescente, que é igual à de `rankingPopularidade(regua.contagens)` e é conferida na preparação. Ficam de fora os filmes de `excluir`, os que já estão na lista e os gêmeos deles. Esses itens recebem `fonte: 'populares'` e o rótulo **"Mais avaliados no MovieLens"**.
7. O `motivo` final é:
   - `'personalizado'` quando os 10 vêm da S1;
   - `'parcial'` quando há mistura de S1 e populares;
   - um dos motivos do passo 4 quando não há S1.

A S1 em si (vetores, perfil, escore, desempate e corte em escore > 0) é a mesma que foi avaliada. O que muda é o **conjunto de exclusão**, que é uma decisão de produto: inclui as interações da aplicação, os gêmeos e o id 267, enquanto a avaliação excluía o que o usuário tinha visto no treino. A documentação deixa claro que a qualidade medida no teste-2 (usuários históricos com ≥ 20 notas, retrospectivo) **não se transfere** para os perfis novos.

## 5. Banco

### 5.1 Schema `app` (criado pelas migrações)

```sql
app.migracao (versao int PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())

-- Referência (escrita só na preparação)
app.filme (
  id int PRIMARY KEY,               -- id do ML-100K
  titulo text NOT NULL, ano int,    -- de u.item; ano pode ser null
  generos text[] NOT NULL,
  tem_vetor boolean NOT NULL,       -- existe em v2_final.filmes_fc
  visivel boolean NOT NULL,         -- false só para o id 267 ("unknown")
  titulo_busca text NOT NULL        -- minúsculas, sem acento (para ILIKE)
)
app.estatistica_historica (
  filme_id int PRIMARY KEY REFERENCES app.filme,
  n_notas int NOT NULL, soma_notas int NOT NULL, n_aprovacao int NOT NULL,  -- notas 4–5
  hash_treino text NOT NULL         -- = configuracao-v2.json hashes.treino
)
app.filme_gemeo (filme_id int REFERENCES app.filme, gemeo_id int REFERENCES app.filme,
  evidencia text NOT NULL, PRIMARY KEY (filme_id, gemeo_id))   -- simétrica: os dois sentidos
app.filme_externo (            -- criada vazia na etapa 1; preenchida na etapa 2 (§11.2)
  filme_id int REFERENCES app.filme, fonte text NOT NULL,  -- 'imdb' | 'tmdb'
  id_externo text NOT NULL, metodo text NOT NULL, origem_versao text NOT NULL,
  PRIMARY KEY (filme_id, fonte))

-- Operacional (escrita pela aplicação)
app.perfil (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 40),
  onboarding_concluido boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now())
app.interacao (
  perfil_id uuid REFERENCES app.perfil ON DELETE CASCADE,
  filme_id int REFERENCES app.filme,
  tipo text NOT NULL CHECK (tipo IN ('gostei','quero_assistir','nota')),
  nota smallint CHECK ((tipo = 'nota') = (nota IS NOT NULL) AND (nota IS NULL OR nota BETWEEN 1 AND 5)),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (perfil_id, filme_id))    -- um único estado por (perfil, filme)
```

- **Gêmeos:** os 18 pares de `u.item` com título idêntico (incluindo o ano), detectados na preparação com `evidencia = 'titulo_identico'`, mais o par 1202/1504 com `evidencia = 'mesmo_imdb_poc_2026-11-15'`, numa lista manual versionada em `app/preparar/gemeos-manuais.json`, que contém só ids e a evidência. Na preparação, um teste confere se 1202 e 1504 têm títulos compatíveis em `u.item` e falha se não tiverem.
- **Os vetores não são fundidos:** cada gêmeo mantém o próprio vetor (a S1 não muda).
- **Interface com gêmeos:** o catálogo mostra os dois registros com o selo "registro duplicado no MovieLens" e um link entre eles. O onboarding mostra só o de menor id.

### 5.2 Papéis e conexões
| Papel | Usado por | Permissões |
|---|---|---|
| superusuário (`POSTGRES_USER`) | só `preparar` | tudo |
| `app_leitura` | pool de leitura do `app` | `USAGE` em `v2_final` e `app`; `SELECT` em `v2_final.*` e em `app.*`. Sem escrita. A conexão usa `search_path=v2_final,public`, exigido por `buscarColaborativos`. |
| `app_escrita` | pool de escrita do `app` | `USAGE` em `app`; `SELECT, INSERT, UPDATE, DELETE` em `app.perfil` e `app.interacao`; `SELECT` em `app.filme`. Sem acesso a `v2_final`. |

As senhas vêm de variáveis com valor padrão no `docker-compose.yml` de `app/`. Isso é aceitável porque o `db` não publica porta e a aplicação só escuta em `127.0.0.1`. O `.env` é **opcional**: só serve para mudar porta ou senhas.

### 5.3 Estatísticas
- **MovieLens (amostra de treino, 1997–98):** `n_notas`, `media = soma/n` e `pct_aprovacao = n_aprovacao/n`.
- **Nesta instalação:** `COUNT` e `AVG` de `app.interacao` com `tipo = 'nota'`, calculados ao vivo.
- **Regra de suficiência por fonte:** com `n < 5`, a média (e o percentual, no histórico) é `null` e vem a flag `amostra_insuficiente: true`. A contagem aparece sempre.
- **As fontes nunca são somadas.**
- A **média bayesiana** (`(C·m + soma)/(C + n)`, com C = 10 e m = a média global do treino) serve **só para ordenar** o catálogo em "Mais bem avaliados" e nunca é exibida.

## 6. API (JSON, prefixo `/api`)

Convenções:
- erros no formato `{ codigo, mensagem }`;
- validação por JSON Schema no Fastify, com corpo máximo de 4 KB;
- ids de filme inteiros, de 1 a 1682;
- `perfilId` em UUID.

Não há autenticação: os perfis são locais, como os perfis de uma TV, e o servidor só escuta em localhost (§9).

| Método e rota | Entrada | Saída e regras |
|---|---|---|
| `GET /saude` | — | `{ estado: 'ok' \| 'bloqueado', motivo? }` |
| `GET /sobre` | — | hashes conferidos, `commitCodigo`, versão do app, textos de licença e citação, o aviso de escopo da qualidade medida |
| `GET /perfis` | — | `[{ id, nome, onboardingConcluido, contagens: { notas, gostei, queroAssistir } }]` |
| `POST /perfis` | `{ nome }` | `201` com o perfil. No máximo 20 perfis por instalação (`409 LIMITE_PERFIS`). |
| `PATCH /perfis/:id` | `{ nome?, onboardingConcluido? }` | perfil |
| `DELETE /perfis/:id` | — | `204`; apaga as interações em cascata |
| `GET /perfis/:id/onboarding` | `pagina`, `genero?` | 24 filmes por página: só com `tem_vetor`, `visivel` e não interagidos, sem o gêmeo de maior id, ordenados por `n_notas` decrescente. Cada filme traz o estado atual. |
| `PUT /perfis/:id/interacoes/:filmeId` | `{ tipo: 'gostei' }`, `{ tipo: 'quero_assistir' }` ou `{ tipo: 'nota', nota: 1..5 }` | Upsert: **a última ação vence**. Devolve `{ interacao, filme: { temVetor, influenciaRecomendacoes } }`. `influenciaRecomendacoes` = `temVetor && (tipo = 'gostei' \|\| nota ≥ 4)`. |
| `DELETE /perfis/:id/interacoes/:filmeId` | — | `204`; o filme volta a "nenhum" (sem "gostei" escondido) |
| `GET /perfis/:id/interacoes` | `tipo?` (`nota`, `gostei`, `quero_assistir`), `pagina` | lista com dados do filme; `tipo=quero_assistir` alimenta a tela "Minha lista" |
| `GET /perfis/:id/recomendacoes` | — | ver abaixo |
| `GET /filmes` | `q?`, `genero?`, `ordem` (`mais_avaliados`, `mais_bem_avaliados`, `titulo`, `ano`), `pagina`, `perfilId?` | 24 por página: `{ itens: [CartaoFilme], total, pagina }`. Só filmes `visivel`. A busca ignora caixa e acentos. |
| `GET /filmes/:id` | `perfilId?` | `DetalheFilme` |
| `GET /generos` | — | os 19 gêneros do ML-100K, com rótulo em português |
| `GET /diagnostico/busca` | `perfilId` | **Só existe se `APP_DIAGNOSTICO=1`**; sem isso, a rota responde 404. Roda HNSW e exata para o perfil e devolve as duas listas e a sobreposição. Nunca alimenta a tela principal. |

**Tipos:**
```
Midia        = { cartaz: { tipo: 'gerado' } | { tipo: 'externo', url, largura, altura },
                 sinopse: string | null,
                 atribuicao: { texto, url, logo } | null }        // etapa 1: sempre gerado/null/null
CartaoFilme  = { id, titulo, ano, generos, temVetor, gemeoDe: number|null, midia,
                 estadoPerfil: null | { tipo, nota } }
DetalheFilme = CartaoFilme & { estatisticas: {
                 movielens:  { nNotas, media|null, pctAprovacao|null, amostraInsuficiente },
                 instalacao: { nNotas, media|null, amostraInsuficiente },
                 sua: { tipo, nota } | null } }
Recomendacoes = { perfilId, geradoEm,
                  motivo: 'personalizado'|'parcial'|'sem_curtidas'|'curtidas_sem_vetor',
                  perfil: { curtidas, curtidasComVetor },
                  itens: [{ posicao, fonte: 'S1'|'populares', escore: number|null, filme: CartaoFilme }],
                  busca: { mecanismo: 'S1/HNSW', m: 150, linhasPedidas, empateNaoResolvido,
                           candidatosS1, excluidos } }
```

**Erros de busca:** se `buscarColaborativos` lançar erro, por exemplo um hash que mudou depois do início, a rota responde `503 BUSCA_INDISPONIVEL`. Ela **não** cai para populares em silêncio, e o servidor passa para o modo bloqueado. Já o preenchimento por populares nos casos da §4.3, passos 4 e 6, é parte da S1 avaliada e vem sempre marcado no `fonte` e no `motivo`.

## 7. Frontend (React + Vite, em português)

**Estado:** o perfil ativo fica no `localStorage`, dentro de try/catch; se o valor falhar, a tela volta para "Quem está usando?". Nada mais do estado fica no navegador.

| Componente/tela | Conteúdo |
|---|---|
| `Moldura` | cabeçalho (perfil ativo, trocar de perfil, Top 10, Catálogo, Minha lista, Minhas avaliações, Sobre), rodapé com a citação do MovieLens e um aviso curto "projeto acadêmico" |
| `TelaPerfis` | "Quem está usando?": cartões de perfil, criar, renomear e excluir (com confirmação, avisando que as avaliações serão apagadas) |
| `Onboarding` | Explica a ideia: "Marque filmes que você já viu e gostou. Com 3 ou mais, suas recomendações ficam mais pessoais." Grade com `CartaoFilme` e os três controles (`Gostei`, `Quero assistir`, `Estrelas`). Filtro por gênero e busca. Um contador "N filmes curtidos". O botão "Ver minhas recomendações" fica sempre ativo, mesmo com 0 curtidas; nada é obrigatório. |
| `Catalogo` | `BarraBusca` (texto, gênero, ordem), `GradeFilmes` paginada, `CartaoFilme` com o estado do perfil |
| `DetalheFilme` | `Cartaz` grande, título, ano e gêneros, `ControleInteracao` (estrelas 1 a 5, "Gostei", "Quero assistir", "Remover"; mostra o estado único atual), `PainelEstatisticas` com as três seções separadas e o aviso "amostra insuficiente", e o aviso "este filme não influencia suas recomendações" quando ele não tem vetor |
| `Top10` | `ListaRecomendacoes` numerada, com um selo por item: "Para você", ou "Mais avaliados no MovieLens" para os populares. Uma `ExplicacaoMotivo`, um texto por motivo (ver abaixo), e o link "Como isso funciona?" para a tela Sobre. Recarrega ao montar e depois de cada interação. |
| `MinhaLista` | filmes "Quero assistir", com as ações "Já assisti: avaliar" e "Remover da lista" |
| `MinhasAvaliacoes` | notas e "gostei", com edição inline e exclusão |
| `Sobre` | em linguagem simples: o que é a S1; que a avaliação foi feita com usuários históricos e não se transfere automaticamente para perfis novos; o que significam as estatísticas; as licenças; a citação de Harper & Konstan (2015); os hashes conferidos |
| `Cartaz` | ver abaixo |
| `TelaBloqueada` | mostrada quando `/saude` responde `bloqueado`: a causa e o comando `docker compose run --rm preparar` |

**Componente `Cartaz`:**
- Recebe `filme` e `midia`.
- Com `midia.cartaz.tipo === 'gerado'`, ou no `onerror` de uma imagem externa, renderiza um **SVG local na proporção 2:3**: cor de fundo determinística pelo primeiro gênero, título com quebra de linha, ano e ícone do gênero. Não faz nenhuma requisição.
- Quando houver cartaz externo, a partir da etapa 2: `<img loading="lazy" referrerpolicy="no-referrer">`, com a atribuição exibida quando `midia.atribuicao` vier preenchida.

**Textos de `ExplicacaoMotivo`:**
- `sem_curtidas`: "Você ainda não marcou filmes de que gostou. Enquanto isso, mostramos os mais avaliados no MovieLens. Marque alguns filmes como 'Gostei' ou dê 4–5 estrelas."
- `curtidas_sem_vetor`: "Os filmes que você curtiu não foram curtidos por ninguém na amostra histórica, então ainda não conseguimos compará-los. Experimente curtir outros."
- `parcial`: "Encontramos menos de 10 filmes parecidos com seus gostos; completamos com os mais avaliados."
- `personalizado`: "Filmes curtidos por pessoas que curtiram os mesmos filmes que você."

**Acessibilidade:**
- as estrelas são um `radiogroup` navegável pelo teclado;
- os selos não dependem só de cor;
- há contraste AA;
- o layout funciona a partir de 360 px de largura.

**Política de conteúdo:** CSP `default-src 'self'; img-src 'self' data:`. Na etapa 2, o fornecedor autorizado é acrescentado em `img-src` por configuração. Na etapa 1, a aplicação **não faz nenhuma requisição externa** em tempo de execução.

## 8. Instalação local

Pré-requisito: Docker Desktop (Windows e Mac) ou Docker Engine com o Compose v2 (Linux), e cerca de 2 GB livres. Não precisa de Node, de chave nem de `.env`.

```
git clone https://github.com/<conta>/recomendacao-filmes.git
cd recomendacao-filmes/app
docker compose up --build
# primeira vez: baixa ~5 MB do MovieLens e prepara o banco (alguns minutos)
# abrir http://localhost:3000
```

- **Parar e retomar:** `Ctrl+C` e depois `docker compose up`, que reaproveita a preparação.
- **Apagar tudo:** `docker compose down -v`.
- **Refazer a preparação:** `docker compose run --rm preparar`.

O README ganha a seção "Rodar a aplicação", com:
- passos para leigos e capturas de tela com os cartazes gerados;
- uma seção de problemas comuns: porta ocupada (`APP_PORTA`), Docker parado, falta de internet na primeira preparação e hash que não confere;
- os avisos de licença.

O README completo e acessível é revisado no fim do projeto.

**Arquivos novos fora de `app/`:**
- `.dockerignore`, que exclui `data`, `artefatos`, `modelos`, `node_modules`, `.superpowers`, `.env` e `app/node_modules`;
- `.github/workflows/app.yml`;
- entradas no `.gitignore` para `app/node_modules/`, `app/dist/` e `app/.env`.

**O que não é tocado:** `src/`, `scripts/`, `package.json`, `package-lock.json`, `resultados/`, `docker-compose.yml` e `.env.example` da raiz.

**Modo de desenvolvimento, sem Docker para o app, para quem desenvolve:** `npm ci` em `app/` e o `db` do Compose de `app/` com a porta publicada por um `compose.override.yml` de desenvolvimento.

## 9. Segurança e privacidade

- **Rede:** o servidor escuta em `0.0.0.0` só dentro do contêiner, e a publicação é restrita a `127.0.0.1`. O README avisa para não expor a aplicação na rede: ela não tem senha.
- **LGPD:** coleta mínima, só o nome do perfil e as interações. Sem e-mail, sem telemetria e sem requisição externa em tempo de execução. Excluir o perfil apaga tudo.
- **Mínimo privilégio:** os papéis da §5.2. Um teste confere se `app_escrita` não consegue escrever em `v2_final` e se `app_leitura` não consegue escrever em nada.
- **Consultas:** SQL só com parâmetros, e os nomes de schema vêm de constantes.
- **Validação:** entrada validada por esquema, limite de corpo e `helmet` (Fastify), incluindo a CSP da §7.
- **Diagnóstico:** a rota exata fica desligada por padrão.
- **Imagem e segredos:** a imagem roda como usuário não root (`node`). Os segredos não ficam na imagem, porque o `.dockerignore` exclui o `.env`.

## 10. Isolamento da pesquisa e reprodutibilidade

1. **Teste estático `app/testes/isolamento.test.js`**, que varre `app/` inteiro. Regras:
   - nenhum arquivo importa `src/modelo/*`, `@tensorflow/*`, `src/dados/teste2.js`, `src/dados/divisoes.js` ou `src/avaliacao/*`;
   - `criarContexto` e `src/dados/*` aparecem **só** em `app/preparar/`, com `fase: 'v2-final'` literal, e as strings `incluirTeste2` e `incluirTeste` não aparecem em `app/`;
   - `app/servidor/` só importa da raiz `src/banco/busca-fc.js`, `src/fc/referencia.js` e `src/candidatos/populares.js`;
   - nenhum arquivo de `app/` escreve fora dos volumes;
   - `modo: 'hnsw'` e `m: 150` aparecem como constantes num único módulo (`app/servidor/recomendacao/s1.js`).
2. **Teste de congelamento** no CI: `git diff --exit-code c048537 HEAD -- src scripts package.json package-lock.json` e `git diff --exit-code HEAD -- resultados`. Ao fim da suíte, `git status --porcelain` precisa estar vazio, para provar que a aplicação e os testes não deixam arquivos não rastreados.
3. **Equivalência com a referência:** um teste de integração monta 20 perfis sintéticos, com semente fixa, entre 1 e 15 curtidos, incluindo curtidos sem vetor e gêmeos. Para cada um, compara a lista da aplicação **em modo exato**, chamando o mesmo módulo com um parâmetro interno só de teste, com `rankingReferencia(fc, perfil, excluir, 150)` cortado em 10 e completado com populares. A igualdade tem de ser exata, lista e escores. O HNSW **nunca** é comparado com uma lista fixa: no modo HNSW, o teste só confere as invariantes (10 itens, sem excluídos, escores decrescentes e > 0, `fonte` coerente).
4. **Hashes:** a preparação e a inicialização falham ou bloqueiam se qualquer um dos três hashes não bater (§4.1, §4.2). Um teste de integração adultera `v2_final.metadados.hash_treino` num banco descartável e confere o modo bloqueado e o `503`.
5. **Determinismo entre plataformas:** um job de CI em Windows, macOS e Linux, sem Docker, baixa o ML-100K, confere o MD5 e calcula `regua.hash`, `hashAvaliacoes(treino)` e `hashVetoresFC(construirFC(treino, 943))` via `criarContexto({ fase: 'v2-final' })`, comparando com `configuracao-v2.json`.
6. **Tag:** antes do primeiro commit de código da aplicação, cria-se a tag local `pesquisa-plano3-final` no commit `6077974`. Ela só vai para o GitHub com a autorização do usuário.

## 11. Mídia (cartazes e sinopses): arquitetura agora, fornecedor depois

### 11.1 Etapa 1
- Módulo `app/servidor/midia/` com a interface `fornecedor.midia(filme) → Midia` e o registro `MIDIA_FORNECEDOR` (padrão `local`).
- A etapa 1 só tem o fornecedor `local`, que devolve `{ cartaz: { tipo: 'gerado' }, sinopse: null, atribuicao: null }`.
- O frontend já trata `externo`, o `onerror` e a atribuição. Assim, um fornecedor futuro só exige um adaptador no backend e uma entrada de CSP.
- Nenhum dado de mídia entra no recomendador, e o teste de isolamento proíbe `app/servidor/recomendacao/` de importar `midia/`.

### 11.2 Etapa 2: requisitos já decididos, não implementados agora
- **TMDB, ou outro fornecedor autorizado:** adaptador opcional, ativado por chave no `.env`. **Seu uso definitivo depende de confirmar** que os termos são compatíveis com o projeto: a cláusula do TMDB sobre aplicações "ML or AI based" não é resolvida pelo fato de a chave ser da própria pessoa. Sem a confirmação, o adaptador não é ativado na entrega.
- **Mapeamento MovieLens → IMDb/TMDB:** gerado na máquina de quem roda, por **ação explícita** (`docker compose run --rm mapear`). É opcional e não bloqueante: o app funciona igual sem ele.
  - **Fonte padrão:** o `ml-latest-small`, que cobriu 1.335 dos 1.682 filmes (79,4%) na prova de conceito.
  - **Fonte completa:** o `ml-latest`, que cobriu 1.637 (97,3%). Só com a opção `--completo`. A prova de conceito extraiu apenas `movies.csv` e `links.csv` (cerca de 2,5 MB) por HTTP Range; se o servidor não aceitar Range, o comando avisa e pede confirmação antes de baixar o zip inteiro.
  - **Registro:** a URL, o ETag ou Last-Modified, o sha256 dos CSVs usados e a data vão para `app.filme_externo.origem_versao`, junto com um relatório de correspondências.
  - **Regras conservadoras:** só associação exata por título e ano é aceita automaticamente. Ano ±1, prefixo e casos ambíguos vão para revisão e ficam sem associação até uma decisão manual registrada em arquivo versionado de ids, com a justificativa.
  - **Gêmeos:** os pares herdam o mesmo id externo. O id 267 nunca é associado.
  - **Validação objetiva** antes de aceitar qualquer taxa de erro:
    - 100% dos casos não exatos auditados manualmente contra a página do IMDb;
    - mais uma amostra aleatória estratificada dos exatos, com tamanho definido no plano da etapa 2;
    - erros relatados com limite superior de Clopper-Pearson a 95%.

    A estimativa de 0,1% a 0,5% da prova de conceito **não** é aceita como resultado.

## 12. Testes

| Nível | Ferramenta | O que cobre |
|---|---|---|
| Unidade (`app/`) | `node:test` | regra do estado único e precedência; `curtidos` e `interagidos`; exclusão com gêmeos e 267; preenchimento por populares, incluindo gêmeos dentro da lista; `motivo`; suficiência das estatísticas (n = 4 → média `null`, n = 5 → média); a média bayesiana só na ordenação; o `Cartaz` gerado de forma determinística |
| Isolamento | `node:test` | §10.1 e §10.2 |
| Integração (banco real, Compose de teste) | `node:test` | migrações idempotentes; papéis (§9); conferência de hashes e modo bloqueado; equivalência exata (§10.3); invariantes HNSW; contratos de todas as rotas, incluindo 400, 404, 409 e 503; `DELETE` de perfil em cascata; `/diagnostico` responde 404 sem a variável; a rota de recomendações ignora `?modo=exata` e `?m=` |
| Componentes | Vitest + Testing Library | `ControleInteracao` (estado único), `PainelEstatisticas` (três fontes, amostra insuficiente), `ExplicacaoMotivo`, `Cartaz` (fallback no `onerror`), `TelaBloqueada` |
| Ponta a ponta | Playwright (Chromium) | Fluxo principal: criar perfil → onboarding com 3 "gostei" → Top 10 com 10 itens, `fonte` S1 → dar 5 estrelas a um item do Top 10 → ele some e o Top 10 se recalcula → "Quero assistir" num item → ele aparece em Minha lista e não no Top 10 → excluir a nota → o estado volta a nenhum. Perfil vazio → populares com explicação. Teclado nas estrelas. Nenhuma requisição a host externo durante o fluxo. |
| Instalação limpa (CI, Linux) | GitHub Actions | ver §13, critério 1 |
| Determinismo (CI, 3 SOs) | GitHub Actions | §10.5 |

## 13. Critérios de aceite

1. **Instalação limpa**, com o mesmo peso dos demais critérios. Uma pessoa clona o repositório em outro computador, segue o README, prepara o banco e abre a aplicação localmente, sem nenhum arquivo privado do ambiente de desenvolvimento e sem chave de serviço externo. A prova tem duas partes:
   - **Automática (CI, Linux):**
     - o workflow faz checkout numa pasta nova, sem cache de Docker e com volumes novos;
     - roda `cd app && docker compose up -d --build` e espera `/api/saude` responder `ok` em até 10 minutos;
     - confere no log de `preparar` os três hashes iguais a `configuracao-v2.json`;
     - roda o fluxo principal do Playwright contra o contêiner;
     - roda o caso negativo (hash adulterado → modo bloqueado);
     - roda `docker compose down -v`.
   - **Manual, antes da entrega:** o mesmo roteiro do README executado uma vez em Windows com Docker Desktop, num clone novo, com o resultado registrado (data, versões e tempo).
2. **S1 preservada:** o teste de equivalência exata (§10.3) passa, o teste de isolamento (§10.1) passa, e o diff de congelamento (§10.2) fica vazio.
3. **Funcionalidades:**
   - perfis;
   - onboarding opcional;
   - catálogo com busca, filtro e ordenação;
   - estrelas com edição e exclusão;
   - "Gostei";
   - "Quero assistir" com a Minha lista;
   - Top 10 atualizado depois de cada interação;
   - estatísticas em três fontes separadas;
   - tudo coberto pelos testes de contrato e pelo Playwright.
4. **Casos-limite atendidos e testados:** perfil vazio, curtidas só sem vetor, déficit de candidatos, filme sem vetor avaliado, gêmeos, o id 267, hash divergente e banco indisponível.
5. **Sem dependência externa em tempo de execução:** o fluxo do Playwright não faz nenhuma requisição fora de localhost.
6. **Comunicação honesta:** a tela Sobre e o README dizem que a qualidade medida vale para usuários históricos no teste retrospectivo, não para perfis novos.
7. **Licenças:** o repositório não tem dados do MovieLens, cartazes nem sinopses. A citação aparece no rodapé e no README.

## 14. Decisões tomadas pelo assistente (para revisão do usuário)
- **Perfis locais sem senha**, no estilo de perfis de TV, com escuta só em localhost. A alternativa seria uma conta com senha, o que acrescenta superfície de ataque e dados pessoais sem ganho num app local.
- **Stack:** Fastify, React + Vite, Vitest, Playwright e GitHub Actions.
- O servidor **sobe em modo bloqueado** quando os hashes não conferem, em vez de encerrar.
- O id 267 fica oculto do catálogo e excluído das recomendações.
- Os gêmeos aparecem como dois registros com selo, e o onboarding mostra só um deles.
- Limite de 20 perfis por instalação; página de 24 itens; C = 10 na média bayesiana.
- O Compose de `app/` é um projeto separado do banco da pesquisa e não publica a porta do banco.
- O `.env` é opcional, com valores padrão no Compose.

## 15. Deixado para quem constrói
- A organização interna dos módulos de `app/servidor` e dos componentes React, respeitando os nomes de contrato acima.
- O estilo visual: tipografia, paleta e ícones de gênero, mantendo contraste AA.
- O formato exato das mensagens de log da preparação, que precisa incluir os três hashes.
- O tamanho da amostra de validação do mapeamento: plano da etapa 2.
