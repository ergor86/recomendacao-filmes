# Aplicação local sobre a S1: design da etapa 1 (MVP)

Data: 2026-11-16. Status: **v3.1, aprovada conceitualmente pelo usuário** em 2026-11-16, com dois ajustes (§4.3) e a decisão sobre o TMDB (§11.2). A v2 foi revisada por quatro subagentes (reprodutibilidade e isolamento; instalação, segurança e integração; experiência de uso; checagem de quem constrói). A v3 incorpora uma revisão curta e direcionada de 7 pontos, levantados por uma revisão externa e contestados por dois subagentes. Nada foi implementado. As mudanças estão na §16.

## 1. Intenção

Transformar o resultado do Plano 3 numa aplicação que qualquer pessoa consiga rodar no próprio computador. Nela, a pessoa:
- cria um perfil;
- marca filmes de que gosta;
- avalia filmes do catálogo do MovieLens 100K;
- recebe na hora um top 10 calculado pela **S1**, a filtragem colaborativa item-item com busca HNSW, com os mesmos vetores, perfil, escore e regras da configuração escolhida e congelada no Plano 3.

O projeto é acadêmico (pós-graduação, unidade de Deep Learning e Sistemas de Recomendação) e de portfólio. O código fica público no GitHub e será divulgado no LinkedIn, sem hospedagem permanente. O público são pessoas que **não conhecem o projeto**: a instalação e a interface precisam ser simples, e os limites científicos precisam ficar claros sem assustar ninguém.

### 1.1 Objetivos
1. Ter perfis locais e um onboarding opcional e curado.
2. Ter um catálogo pesquisável.
3. Ter três sinais distintos:
   - estrelas de 1 a 5, com edição e exclusão;
   - "Já assisti e gostei";
   - "Quero assistir", com a lista pessoal "Minha lista".
4. Mostrar um top 10 da S1 recalculado sob demanda, sem botão de treino, explicando cada item ("porque você curtiu X").
5. Mostrar estatísticas por filme em fontes **separadas**: o histórico do MovieLens (treino `v2-final`), as notas deste computador e a nota da própria pessoa.
6. Usar um cartaz **gerado localmente** como padrão. A arquitetura de mídia fica pronta para um fornecedor externo autorizado, sem refatorar o frontend nem o recomendador.
7. Ter uma instalação limpa com Docker Compose, sem credenciais de serviços externos e sem arquivos privados do ambiente de desenvolvimento.
8. Ter um "Perfil de exemplo" e um README com GIF e capturas de tela, para quem não vai instalar.

### 1.2 Fora do escopo da etapa 1
- Um fornecedor externo de cartazes ou sinopses. **O TMDB não será implementado** enquanto não houver autorização expressa e aplicável ao projeto (§11.2). Um outro fornecedor só entra com licença comprovadamente compatível.
- O mapeamento MovieLens → IMDb/TMDB (etapa 2, §11.2).
- O relatório de cold start (etapa 2).
- O feedback negativo (etapa 3, com a S1 preservada como referência).
- A reconstrução de vetores, o retreino, novas técnicas, a demografia, o site público, contas com senha e o acesso pela rede.

### 1.3 Anti-objetivos (falham o projeto mesmo que "funcione")
- Alterar algo congelado:
  - `src/`, `scripts/`, `package.json` e `package-lock.json` da raiz;
  - `resultados/`;
  - o banco e os `artefatos/` da pesquisa.

  Também conta deixar arquivos não rastreados que quebrem `conferirCongelamento`.
- Ler o gabarito: o `u1.test`, o `u.data` ou o teste-2 com `incluirTeste2`. Também conta rodar qualquer experimento novo sobre o teste-2.
- Apresentar a qualidade medida no teste-2 como qualidade para perfis novos.
- Trocar a S1 por outro mecanismo sem avisar.
- Redistribuir pelo repositório os dados do MovieLens, cartazes ou sinopses de terceiros.
- Exigir uma chave pessoal de serviço externo.
- Fazer o catálogo ou as recomendações dependerem de imagens externas.

## 2. Restrições herdadas (verificadas no código)

- **Banco:** Postgres 17 + pgvector 0.8.1, imagem `pgvector/pgvector:0.8.1-pg17@sha256:3e8b3adfd27b5707128f60956f62a793c3c9326ea8cfaf0eab7adccb5d700b21`, um índice multiarquitetura (amd64 e arm64).
- **Script 16:** `scripts/16-carregar-v2.js --fase v2-final`, congelado. Ele:
  - cria o schema `v2_final` com `filmes`, `filmes_fc` (1.385 vetores `vector(943)`, índice HNSW de cosseno) e `metadados`, que guarda `hash_regua` e `hash_treino`;
  - grava `artefatos/regua-v2-final.json` relativo ao **diretório atual**, depois do COMMIT;
  - faz `import 'dotenv/config'`, que lê o `.env` do diretório atual;
  - faz `DROP` e `CREATE` das tabelas a cada execução;
  - tenta conectar uma única vez, sem nova tentativa;
  - tem uma cadeia de 16 módulos que não importa o TF.js nem pacotes com script de instalação. Ela inclui `src/contexto.js` → `dados/teste2.js` e `dados/divisoes.js`.
- **Hashes congelados:** em `resultados/configuracao-v2.json` (o mesmo de `6077974`):
  - `regua` = `12119b16edab32568ad1e3e147d793da98b07ec17c46b5f8d695187f91c1521a`;
  - `treino` = `ac6c0eacd7ab52a956a07dd948105aee86b354651e106b0a41a0652661ba377a`;
  - `vetoresFC` = `08325f426922df6138519c8dc712bd21ad8a5c298f53d5eed1ce249517f44861`.
- **A S1 avaliada** (`src/avaliacao/etapa1.js:24,242`, `src/candidatos/v2.js:127`, `src/avaliacao/sistemas-v2.js:60`) funciona assim:
  - uma busca HNSW por usuário com **M = 300** (`ef_search` = 350), chamada `H_300`;
  - FC150 = os 150 primeiros de `H_300`, completados com populares não vistos;
  - top 10 = `FC150.slice(0, 10)`.

  O top 150 de outra busca, com outro `ef_search`, **não** é necessariamente prefixo de `H_300` (spec do Plano 3, §6).
- **Busca:** `buscarColaborativos(pool, { vetor, excluir, m, hashes:{regua,treino}, modo })`.
  - Pede m + 50 linhas, e `ef_search = max(pedidas, 40)`.
  - Usa REPEATABLE READ, `current_schema()` e GUCs `SET LOCAL`, que não exigem privilégio.
  - Exige `USAGE` em `v2_final` e `search_path=v2_final,public`. Sem o `USAGE`, `current_schema()` cai para `public` e a mensagem de erro engana.
- **Precisão:** o pgvector calcula o cosseno em float32, e `rankingReferencia` em float64. O Plano 3 aceitou divergências de precisão com τ = 1e-5 (`conferirPrecisao`/`conferirExataUsuario` em `src/avaliacao/fidelidade.js`), e no v2-final 461 de 462 listas saíram iguais.
- **Funções:**
  - `perfilFC(fc, curtidos)` devolve `null` quando nenhum curtido tem vetor, e `vetorDeBusca(null)` lança erro;
  - `rankingReferencia(fc, perfil, vistos: Set, m)`;
  - `hashVetoresFC(fc)` faz o hash só do suporte (os fãs);
  - a popularidade vem de `regua.contagens` (os 1.682 filmes, inclusive os com 0 notas), ordenada por `rankingPopularidade` (contagem decrescente, depois id crescente).
- **Arquivos do ML-100K usados** (sha256 dos arquivos da pesquisa, calculados em 2026-11-16):

  | Arquivo | sha256 |
  |---|---|
  | `u1.base` | `ce253ec86c448b44fb3ba9a30d12dcfc2e9210cbde71efada3730c22e9ac212a` |
  | `u.item` | `553841ebc7de3a0fd0d6b62a204ea30c1e651aacfb2814c7a6584ac52f2c5701` |
  | `u.user` | `f120e114da2e8cf314fd28f99417c94ae9ddf1cb6db8ce0e4b5995d40e90e62c` |
  | `u.genre` | `9757e0d3e6b298159a80dd48eaf938114690e911e39af97a76949ef1663610bb` |
  | `u.occupation` | `cd5fbec9afe345d993a62fc7817df1a4a9079c4feb267b3118763b8fd942137d` |

- **Congelamento:** `conferirCongelamento` exige o diff vazio desde `c048537911c14313c4e85c516270513871a14a88` em `src scripts package.json package-lock.json` e a árvore limpa. Os pathspecs do git são **relativos ao diretório atual**.
- **Licenças:**
  - MovieLens: sem redistribuição e sem uso comercial; citar Harper & Konstan (2015).
  - Cinemeta/MetaHub: descartados, porque os termos restringem o uso ao Stremio e o MetaHub não autoriza exibir imagens.

## 3. Abordagens consideradas

| Abordagem | Troca |
|---|---|
| **A. App em `app/` que importa os módulos congelados só para leitura, com um Compose próprio (`db`, `preparar`, `app`)** (escolhida) | Reaproveita exatamente o código avaliado. Exige cuidado com dependências, permissões e diretórios de trabalho. |
| B. Copiar a lógica da S1 para `app/` | Duas implementações podem divergir. Contraria "não modificar a S1". |
| C. Pré-calcular o top 10 para perfis fixos | Não atende "atualizado na hora" nem perfis novos. |

O usuário aprovou a opção A dos vetores (congelados, só leitura) e a pasta `app/` separada.

## 4. Arquitetura

```
docker compose (name: recomendacao-app; arquivo app/compose.yml)

 db (pgvector, sem porta no host, healthcheck)
  ▲            ▲
  │            │ (pools só depois de "pronto")
 preparar ──► volume app_estado: estado.json (progresso, sem segredos) + credenciais.json (0600)
  │            ▲
  │            │ lê (montado :ro; é o único volume do app)
  │           app (Node 22, escuta 0.0.0.0:3000 no contêiner; publicado só em 127.0.0.1:APP_PORTA)
  │                                                            ── navegador (React)
  │           sobe junto com o db; mostra "Preparando…" até o estado ficar "pronto"
  └─ volumes: app_dados_ml (só os 5 arquivos), app_trabalho (cwd do script 16)
```

### 4.1 Serviços (`app/compose.yml`, com `name: recomendacao-app` no topo)
- **db:**
  - imagem com digest (§2), volume `app_dados_pg`, **sem `ports`**, `restart: unless-stopped`;
  - `healthcheck: pg_isready -h 127.0.0.1 -U $$POSTGRES_USER -d $$POSTGRES_DB`, com `interval` de 2 s, `retries` 30 e `start_period` de 30 s;
  - `POSTGRES_PASSWORD` tem um valor padrão no compose. Isso é aceitável porque o banco não é publicado. A senha do superusuário só vale na primeira inicialização do volume: trocá-la exige `down -v` ou um `ALTER ROLE`, e isso fica documentado.
- **preparar:**
  - `build` da imagem `recomendacao-app:local`, com contexto `..` e `app/Dockerfile`;
  - `depends_on: db: condition: service_healthy`, `restart: "no"`;
  - executa `node app/preparar/index.js` (§4.2);
  - `environment: APP_PORTA: ${APP_PORTA:-3000}`, só para imprimir a URL correta;
  - volumes: `app_dados_ml`, `app_trabalho` e `app_estado` (leitura e escrita).
- **app:**
  - `image: recomendacao-app:local` com `pull_policy: never`, sem um segundo `build`;
  - `depends_on: db: condition: service_healthy`. **Não espera o `preparar`.**
  - `restart: unless-stopped`;
  - `ports: "127.0.0.1:${APP_PORTA:-3000}:3000"` e `environment: APP_PORTA: ${APP_PORTA:-3000}`. A mesma expressão aparece nos dois lugares, porque a interpolação em `ports:` não injeta a variável no contêiner;
  - o servidor escuta sempre em `0.0.0.0:3000` **dentro** do contêiner. Quem restringe ao localhost é a publicação;
  - executa `node app/servidor/index.js`;
  - volumes: **só** `app_estado:/var/app/estado:ro`. O `app_dados_ml`, que tem o `u1.base`, e o `app_trabalho` ficam montados apenas no `preparar`, o que garante fisicamente que o servidor não lê os dados brutos.

**Imagem** (`app/Dockerfile`, multi-stage, base `node:22-bookworm-slim@sha256:<digest do índice multiarquitetura, fixado por quem constrói>`; Alpine é proibido):
1. O estágio `web` instala `app/web` com `npm ci` e roda `vite build`.
2. O estágio de execução:
   - roda `npm ci --omit=dev --ignore-scripts` na raiz e depois `rm -rf node_modules/@tensorflow`. Os arquivos versionados não mudam, e o teste de isolamento garante que nada importa o TF.js;
   - roda `npm ci --omit=dev` em `app/`;
   - copia o `dist` do estágio `web`;
   - roda `RUN mkdir -p /var/app/dados /var/app/trabalho /var/app/estado && chown -R node:node /var/app` **antes** de `USER node`;
   - define `WORKDIR /repo`.
3. O `app/web/package-lock.json`, que é onde o Vite é instalado, precisa ter as entradas `@rollup/rollup-linux-{x64,arm64}-gnu` e `@esbuild/linux-{x64,arm64}`. Ele é gerado ou conferido num contêiner Linux. O CI faz `docker buildx build --platform linux/amd64,linux/arm64`.
4. O Dockerfile usa só `COPY` explícitos (`src`, `scripts`, `package*.json`, `app`). O CI lista o contexto de build e confere que nenhum arquivo fora da lista de permissão entra.

O `.dockerignore` é uma **lista de permissão**:

```
*
!src
!scripts
!package.json
!package-lock.json
!app
**/.env
**/.env.*
**/node_modules
**/dist
**/test-results
**/playwright-report
**/blob-report
**/playwright/.cache
**/coverage
**/*.log
**/*.tsbuildinfo
app/compose.dev.override.yml
```

A sintaxe foi conferida na documentação do Docker e no `moby/patternmatcher`: `*` seguido de `!pasta` funciona, e `**/.env` exclui `app/.env`. O `resultados/` **não** entra na imagem, porque nada o lê em execução: os hashes e os números exibidos vêm das constantes de `app/integridade.js`, conferidas no CI. O CI confere que a imagem não contém `.env`, `app/.env`, `.git` nem `resultados/`.

### 4.2 Preparação (`app/preparar/index.js`)
O estado vai para `/var/app/estado/estado.json`, gravado de forma atômica (arquivo temporário e `rename`): `{ estado: 'preparando'|'pronto'|'falhou', etapa, total, mensagem, causa?, comando?, atualizadoEm }`. **Esse arquivo nunca contém segredos.** As senhas dos papéis ficam num arquivo separado, `/var/app/estado/credenciais.json`, com modo 0600 e dono `node`, gerado só quando não existe e também gravado de forma atômica. O 0600 quase não protege, porque os dois contêineres usam o mesmo UID. O que importa é o arquivo estar separado e nunca ser repassado pela API nem pelos logs. Cada etapa também imprime uma linha numerada no terminal ("3/8: carregando filmes no banco"), e o fim imprime em destaque **`Pronto: abra http://localhost:<porta>`**.

0. **Trava:** `pg_advisory_lock(<constante>)` na sessão. Se outra preparação estiver em andamento, sai com a mensagem "outra preparação em andamento".
1. **Conexão:** até 30 tentativas com espera crescente, porque o script 16 congelado não tenta de novo.
2. **Dados:**
   - se `/var/app/dados/ml-100k` já tiver os 5 arquivos com o sha256 da §2, pula para o passo 3;
   - senão, usa o zip local em `ML100K_ZIP` (montado pelo `compose.local-zip.yml`, documentado) ou baixa `https://files.grouplens.org/datasets/movielens/ml-100k.zip` com `fetch`, `AbortSignal.timeout(60 s)` e 3 tentativas;
   - extrai **só** `u1.base`, `u.item`, `u.user`, `u.genre` e `u.occupation`, por lista explícita, num diretório temporário, confere o sha256 **de cada arquivo** e troca o diretório por `rename`;
   - o MD5 do zip só é registrado no log, porque um zip reempacotado com os mesmos arquivos é aceito;
   - se algum sha256 não bater, o estado vai para `falhou` com uma causa em português.
3. **Carga congelada, só se o banco não estiver pronto:**
   - "pronto" significa que `v2_final.metadados` tem os hashes congelados, que `filmes_fc` tem 1.385 linhas de `vector(943)` e que o selo `app.preparacao` corresponde à versão atual;
   - se não estiver pronto, roda `node /repo/scripts/16-carregar-v2.js --fase v2-final` como subprocesso, com `cwd: /var/app/trabalho`. Assim o `artefatos/` cai no volume e o dotenv não acha nenhum `.env`;
   - o `env` é explícito e completo: `PGHOST=db`, `PGPORT=5432`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` e `DIR_DADOS=/var/app/dados/ml-100k`;
   - **recusa rodar** se o alvo parecer o banco da pesquisa (`PGPORT=5433` ou `PGDATABASE=recomendacao` sem `PREPARAR_ALVO_APP=1`) ou se `v2_final` existir sem o schema `app` no modo de desenvolvimento.
4. **Conferência de integridade:**
   - `hash_regua` e `hash_treino` iguais às **constantes de `app/integridade.js`**. Um teste do CI garante que essas constantes são iguais às de `git show 6077974:resultados/configuracao-v2.json`;
   - `fc` reconstruído de `filmes_fc` com `embedding::real[]` e `vector_dims` = 943, com fãs = posições não nulas + 1. Confere `hashVetoresFC(fc)` e, em cada posição não nula, `|v − Math.fround(1/√|fãs|)| ≤ 1e-7`, além de 1.385 linhas.
5. **Migrações e papéis**, sempre e numa só transação:
   - as migrações SQL idempotentes de `app/banco/migracoes/`;
   - a criação ou o `ALTER ROLE … PASSWORD` dos papéis da §5.2, com as senhas de `credenciais.json`, geradas aleatoriamente na primeira vez e fora do repositório. Como `ALTER ROLE … PASSWORD` não aceita parâmetro `$1`, o literal é montado com `pg.escapeLiteral` (função do módulo `pg`, conferida na versão 8.23.1) e o nome do papel vem de uma constante. É a única exceção declarada à regra "SQL só com parâmetros". Antes do comando, na mesma transação, rodam `SET LOCAL log_statement = 'none'` e `SET LOCAL log_min_error_statement = 'panic'`, para a senha não ir ao log do `db` nem em caso de erro;
   - os GRANTs, mais `ALTER DEFAULT PRIVILEGES FOR ROLE <superusuário> IN SCHEMA v2_final GRANT SELECT ON TABLES TO app_leitura`, o que sobrevive ao `DROP`/`CREATE` do script 16.
6. **Tabelas de referência:**
   - `ctx = criarContexto({ fase: 'v2-final', dirDados })`, com objeto literal e sem spread, seguido de `assert(ctx.alvos === null)`;
   - `app.filme` vem de `ctx.dataset.filmes`;
   - `app.estatistica_historica` vem de `ctx.regua.contagens` (os 1.682 ids, inclusive os de 0 notas) e de somas sobre `ctx.treino`;
   - `app.filme_gemeo` (§5.1);
   - **conferências:** `COUNT(*) = 1682`, `SUM(n_notas) = ctx.treino.length`, `n_notas = regua.contagens[id]` em todos os filmes, e a ordem de `n_notas` decrescente, depois id, igual a `rankingPopularidade(regua.contagens)`.
7. **Selo:** grava `app.preparacao(versao_app, hash_regua, hash_treino, hash_vetores_fc, n_filmes, n_fc, concluida_em)`, na mesma transação dos passos 5 e 6, e escreve `estado: 'pronto'`.
8. **Erro:** em qualquer erro, escreve `estado: 'falhou'`, com a `causa` e o `comando` sugerido, e sai com código 1.

Quando o banco já está pronto, a preparação leva poucos segundos: só os passos 0, 1, 4, 5 e 7.

### 4.3 Servidor (`app/servidor/`)
- **Inicialização:** sobe imediatamente. Enquanto `estado.json` não estiver `pronto`, `/api/saude` responde `{ estado: 'preparando' | 'falhou', etapa, mensagem, causa, comando }`, e as rotas de dados respondem `503 PREPARANDO`. `GET /api/sobre` responde em qualquer estado, por ser conteúdo estático, montado só de constantes (útil na tela de bloqueio). A resposta é montada **campo a campo**, nunca repassando o objeto lido.
- **Credenciais:** o servidor lê `credenciais.json` a cada conferência (§4.3) e recria os pools se as senhas mudaram.
- **Conferência:** quando o estado vira `pronto`, o servidor abre os pools e roda a **conferência** dos passos 4 e 7 da §4.2: hashes, `fc` reconstruído, o selo e o `current_schema()` do pool de leitura igual a `v2_final`. Se passar, ele fica **operante**. Se falhar, fica **bloqueado** com a causa.
- **Reavaliação:** fora do estado operante, cada `GET /api/saude` (limitado a 1 a cada 2 s) refaz a conferência. Assim o servidor se recupera sozinho depois de `docker compose run --rm preparar` ou do retorno do banco, sem reiniciar.
- **Vigilância de integridade no estado operante**, proporcional a um app local. A ameaça considerada é uma nova preparação acidental ou uma edição manual do banco, não um adversário. Há três gatilhos:
  1. **Em cada busca, sem custo extra:** `buscarColaborativos` já confere `hash_regua` e `hash_treino` de `v2_final.metadados` dentro da transação. Uma divergência lança erro, que é classificado como integridade e leva ao bloqueio imediato. O pedido recebe `503 BLOQUEADO`.
  2. **Impressão digital barata, a cada `APP_VIGIA_SEGUNDOS` (padrão 60):** uma consulta lê:
     - os OIDs de `v2_final.filmes`, `v2_final.filmes_fc` e `v2_final.metadados`;
     - o `COUNT(*)` de `filmes_fc`;
     - os dois hashes de `metadados`;
     - o `concluida_em` de `app.preparacao`;
     - o `atualizadoEm` de `estado.json`.

     A cada `APP_VIGIA_CONTEUDO_A_CADA` ciclos (padrão 10, cerca de 10 minutos), ela também lê um resumo do conteúdo, `md5(string_agg(embedding::text, ',' ORDER BY id))` de `filmes_fc`.
  3. **Reconferência integral:** se qualquer valor diferir do retrato tirado na última conferência integral bem-sucedida, o servidor refaz a conferência integral dos passos 4 e 7 da §4.2: hashes, `fc` reconstruído, valores dos vetores e selo. Se passar, por exemplo numa nova preparação legítima com os mesmos hashes, o servidor recarrega o `fc` e tira um novo retrato. Se falhar, bloqueia com a causa.

  **Limite declarado:** uma edição manual dos **valores** dos vetores que preserve os OIDs, a contagem e os hashes só é detectada no ciclo de conteúdo seguinte, até cerca de 10 minutos com os valores padrão. Os hashes nunca são recalculados a cada pedido.
- **Erros:**
  - de **disponibilidade** (ECONNREFUSED, `57P01`, `57P03`, "Connection terminated"): respondem `503 BANCO_INDISPONIVEL` no pedido e **não bloqueiam**;
  - de **integridade** (hash, tabela ausente, `42501 permission denied`): passam ao bloqueio com a causa certa;
  - de **credenciais** (`28P01`, senha recusada): passam ao bloqueio com a causa "credenciais do banco não conferem; rode `docker compose run --rm preparar`". A reconferência relê o arquivo;
  - os dois pools têm `pool.on('error', registrar)`.
- **Gestão de perfis fora do estado operante** (`preparando`, `falhou` ou `bloqueado`):
  - **Rotas liberadas:** só `GET /perfis` e `DELETE /perfis/:id`, que usam só o pool de escrita e o schema `app`. Todas as outras rotas de dados respondem `503 PREPARANDO` ou `503 BLOQUEADO` (`GET /sobre` é a exceção estática descrita acima).
  - **Disponibilidade:** o servidor tenta abrir o pool de escrita sempre que `credenciais.json` existe, e o `/saude` informa `perfis: { disponivel: boolean, motivo? }`. A gestão está disponível quando o pool conecta e `app.perfil` existe.
  - **Quando a exclusão não pode ser garantida:**
    - banco indisponível (`motivo: 'banco_indisponivel'`);
    - credenciais de escrita recusadas, `28P01` (`motivo: 'credenciais'`);
    - schema `app` ainda inexistente, na primeira preparação (`motivo: 'sem_dados'`). Nesse caso ainda não há perfis a apagar.

    Nessas situações a interface diz isso claramente e indica o último recurso, `docker compose down -v`, que apaga tudo, inclusive a preparação.
- **`fc`:** fica em memória. A aplicação **não** lê o treino em tempo de execução.

### 4.4 Pipeline de recomendação (`app/servidor/recomendacao/s1.js`)
As constantes são `M = 300`, `N_FC = 150`, `K = 10` e `MODO = 'hnsw'`, e só existem neste módulo. Para um perfil P:
1. `interagidos(P)`: os filmes com qualquer interação.
2. `curtidos(P)` = `gostei` ∪ notas 4–5.
3. `excluir` = `interagidos(P)` ∪ `OCULTOS`, onde `OCULTOS` = {267} ∪ {gêmeo de maior id de cada par} (§5.1). O resultado é um Set; para a busca, vai como um array ordenado.
4. Se `curtidos` estiver vazio, `motivo = 'sem_curtidas'`. Se `perfilFC(fc, curtidos) === null`, `motivo = 'curtidas_sem_vetor'`. Nos dois casos a lista sai só de populares (passo 7).
5. `vetor = vetorDeBusca(perfil)` e `H = buscarColaborativos(poolLeitura, { vetor, excluir, m: M, hashes, modo: MODO })`.
6. `FC150 = H.lista.slice(0, N_FC)` e `S1 = FC150.slice(0, K)`, com `fonte: 'S1'`.
7. Se faltarem itens até K, completa com populares: a ordem de `n_notas` decrescente, depois id, sem `excluir` e sem os que já estão na lista, com `fonte: 'populares'`.
8. Define o `motivo`:
   - `'personalizado'` quando os 10 vêm da S1;
   - `'parcial'` quando há de 1 a 9 da S1;
   - `'sem_semelhantes'` quando o perfil tem vetor mas a S1 devolveu 0 elegíveis;
   - um dos motivos do passo 4 quando a lista sai só de populares.
9. **Explicação**, que não altera a ordem.
   - Para cada item S1 j, devolve até 2 filmes i de `curtidos` com `|F_i ∩ F_j| > 0`.
   - A ordem é pela contribuição de i ao escore de j, `c_ij = |F_i ∩ F_j| / (√|F_i|·√|F_j|)`, decrescente, e depois por id crescente.
   - A comparação é feita em inteiros, sem ponto flutuante: i vem antes de k quando `a_i²·|F_k| > a_k²·|F_i|`, com `a = |F ∩ F_j|`.
   - Tudo é calculado sobre o `fc` em memória.
   - Todo item S1 tem pelo menos 1 explicação, porque escore > 0 implica um curtido com fã em comum. Um teste confere isso nos 30 perfis da §10.5.
   - Os populares não têm explicação.

**Efeitos de cada interação:**
- "Gostei" e notas 4–5 em filme com vetor entram no perfil.
- **Qualquer** interação tira o próprio filme das recomendações. Isso vale para notas 1–3, "Quero assistir" e "Gostei" em filme sem vetor, e é o mesmo que a avaliação fazia com todos os filmes vistos, qualquer que fosse a nota (`vistosPorUsuario`).
- Notas 1–3 ainda não penalizam filmes parecidos (o feedback negativo fica para a etapa 3).

**O que muda em relação à S1 avaliada:** só o **conjunto de exclusão**. Ele traz as interações da aplicação no lugar dos filmes vistos no treino, mais os `OCULTOS`. Isso fica declarado na tela Sobre e no README.

O índice HNSW é reconstruído em cada instalação, com níveis aleatórios. Por isso a lista aproximada pode diferir, em casos raros, da que o índice da pesquisa daria. A fidelidade HNSW × exata publicada foi medida no índice da pesquisa.

A qualidade medida no teste-2 (usuários históricos com ≥ 20 notas, avaliação retrospectiva) **não se transfere** para perfis novos.

## 5. Banco

### 5.1 Schema `app`
```sql
app.migracao   (versao int PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())
app.preparacao (id int PRIMARY KEY CHECK (id = 1), versao_app text NOT NULL,
                hash_regua text NOT NULL, hash_treino text NOT NULL, hash_vetores_fc text NOT NULL,
                n_filmes int NOT NULL, n_fc int NOT NULL, concluida_em timestamptz NOT NULL)

app.filme (id int PRIMARY KEY, titulo_original text NOT NULL, titulo_exibicao text NOT NULL,
           ano int, generos text[] NOT NULL, tem_vetor boolean NOT NULL,
           visivel boolean NOT NULL, titulo_busca text NOT NULL)
app.estatistica_historica (filme_id int PRIMARY KEY REFERENCES app.filme,
           n_notas int NOT NULL, soma_notas int NOT NULL, n_aprovacao int NOT NULL)
app.filme_gemeo (filme_id int REFERENCES app.filme, gemeo_id int REFERENCES app.filme,
           evidencia text NOT NULL, PRIMARY KEY (filme_id, gemeo_id))      -- simétrica
app.filme_externo (filme_id int REFERENCES app.filme, fonte text NOT NULL, id_externo text NOT NULL,
           metodo text NOT NULL, origem_versao text NOT NULL, PRIMARY KEY (filme_id, fonte))
           -- criada vazia; preenchida só na etapa 2 (§11.2)

app.perfil (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
           nome text NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 1 AND 40),
           exemplo boolean NOT NULL DEFAULT false,
           onboarding_concluido boolean NOT NULL DEFAULT false,
           criado_em timestamptz NOT NULL DEFAULT now())
app.interacao (perfil_id uuid REFERENCES app.perfil ON DELETE CASCADE,
           filme_id int REFERENCES app.filme,
           tipo text NOT NULL CHECK (tipo IN ('gostei','quero_assistir','nota')),
           nota smallint CHECK ((tipo = 'nota') = (nota IS NOT NULL) AND (nota IS NULL OR nota BETWEEN 1 AND 5)),
           atualizado_em timestamptz NOT NULL DEFAULT now(),
           PRIMARY KEY (perfil_id, filme_id))          -- um único estado por (perfil, filme)
```

- **Upsert:** `INSERT … ON CONFLICT (perfil_id, filme_id) DO UPDATE SET tipo, nota, atualizado_em = now()`.
- **`titulo_exibicao`:** move o artigo final para o início ("Usual Suspects, The (1995)" vira "The Usual Suspects") e tira o ano do título. A busca usa `titulo_busca`, que normaliza as duas formas e ignora acentos e artigos.
- **Gêmeos:**
  - são os 18 pares de `u.item` com título idêntico (`evidencia = 'titulo_identico'`), detectados na preparação, com um teste que confere se são exatamente 18;
  - há também o par 1202 ("Maybe, Maybe Not (Bewegte Mann, Der) (1994)") e 1504 ("Bewegte Mann, Der (1994)"), declarado em `app/preparar/gemeos-manuais.json` (só ids e `evidencia = 'mesmo_imdb_poc_2026-11-15'`). Um teste confere se os dois títulos contêm "Bewegte Mann, Der" e o ano 1994;
  - o gêmeo de **menor id** é o canônico. O de maior id tem `visivel = false`: não aparece em lugar nenhum e entra em `OCULTOS`;
  - os vetores **não** são fundidos;
  - o detalhe do canônico diz "o MovieLens tem dois registros deste filme; usamos este".
- **Id 267 ("unknown"):** `visivel = false`, entra em `OCULTOS`, e `GET /filmes/267` responde `404 FILME_NAO_ENCONTRADO`.
- **Interações com filmes ocultos:** um `PUT` responde `404 FILME_NAO_ENCONTRADO`.

### 5.2 Papéis e conexões
| Papel | Uso | Permissões |
|---|---|---|
| superusuário | só `preparar` | tudo |
| `app_leitura` | pool de leitura, `options: '-c search_path=v2_final,public'` só neste pool, nunca via `PGOPTIONS` | `USAGE` em `v2_final` e `app`, `SELECT` em todas as tabelas dos dois schemas (com os privilégios padrão da §4.2, passo 5) |
| `app_escrita` | pool de escrita, sem `search_path` especial | `USAGE` em `app`, `SELECT/INSERT/UPDATE/DELETE` em `app.perfil` e `app.interacao`, `SELECT` em `app.filme`. Sem acesso a `v2_final`. |

As senhas dos dois papéis são aleatórias, geradas pela preparação em `credenciais.json` (§4.2) e lidas pelo `app` no volume de estado, montado só para leitura. **Nenhuma senha de papel fica no repositório, no `estado.json`, nas respostas da API ou nos logs** (teste na §12).

### 5.3 Estatísticas
- **MovieLens (1997–98, 943 pessoas; amostra de treino):** `n_notas`, `media` e `pct_aprovacao` (notas 4–5).
- **Neste computador:** `COUNT` e `AVG` ao vivo das notas em `app.interacao`. Os perfis de exemplo (`perfil.exemplo = true`) **não** entram.
- **Suficiência:** com `n < 5` numa fonte, a média e o percentual vêm `null` e a flag é `poucasNotas: true`. A contagem aparece sempre.
- **As fontes nunca são somadas.**
- A média bayesiana (C = 10, m = a média global do treino) serve só para ordenar "Mais bem avaliados" e nunca é exibida.

## 6. API (JSON, `/api`)

### 6.1 Convenções e segurança
- Erros no formato `{ codigo, mensagem }`.
- Validação por JSON Schema (Fastify, `coerceTypes: false`), corpo de no máximo 4 KB.
- `fastify.removeContentTypeParser('text/plain')`. As escritas com corpo exigem `Content-Type: application/json` (`415 TIPO_NAO_SUPORTADO`); escritas sem corpo não precisam do cabeçalho (e o aceitam com corpo vazio).
- Hook `onRequest`: o `Host` precisa estar em {`localhost:<porta>`, `127.0.0.1:<porta>`, `[::1]:<porta>`}. A `<porta>` vem da variável de ambiente `APP_PORTA` do contêiner, que é a porta **publicada**, a que o navegador manda no `Host`. O `Host` sem porta só é aceito quando `APP_PORTA=80`. A 3000 interna **não** é aceita, salvo quando `APP_PORTA=3000`. Fora disso, `421 HOST_INVALIDO`, contra DNS rebinding.
- Escritas com `Origin` diferente do próprio host, ou com `Sec-Fetch-Site: cross-site`, recebem `403 ORIGEM_INVALIDA`. Sem `@fastify/cors`.
- Ids de filme inteiros de 1 a 1682. `perfilId` em UUID.

**Catálogo de códigos de erro:**

| HTTP | Códigos |
|---|---|
| 400 | `VALIDACAO` |
| 403 | `ORIGEM_INVALIDA` |
| 404 | `PERFIL_NAO_ENCONTRADO`, `FILME_NAO_ENCONTRADO`, `ROTA_NAO_ENCONTRADA` |
| 409 | `LIMITE_PERFIS` |
| 413 | `CORPO_GRANDE` |
| 415 | `TIPO_NAO_SUPORTADO` |
| 421 | `HOST_INVALIDO` |
| 503 | `PREPARANDO`, `BLOQUEADO`, `BANCO_INDISPONIVEL` |

### 6.2 Rotas
| Rota | Entrada | Saída e regras |
|---|---|---|
| `GET /saude` | — | **Sempre 200 quando o `Host` é válido**, montada campo a campo e sem segredos: `{ estado: 'preparando'\|'falhou'\|'bloqueado'\|'operante', etapa?, total?, mensagem?, causa?, comando? }`. Refaz a conferência quando não está operante (§4.3). |
| `GET /sobre` | — | versão do app, os hashes conferidos, `commitCodigo` = c048537 (constante de `app/integridade.js`), os textos de licença, a citação e os avisos de escopo |
| `GET /perfis` | — | `[{ id, nome, exemplo, onboardingConcluido, contagens: { notas, gostei, queroAssistir, curtidos, curtidosComVetor } }]` |
| `POST /perfis` | `{ nome }` | `201`. No máximo 20 perfis, conferido dentro de uma transação com `pg_advisory_xact_lock`. |
| `POST /perfis/exemplo` | — | Cria ou devolve o "Perfil de exemplo": `exemplo = true`, com os "gostei" de `app/servidor/exemplo.json`, uma lista versionada de 6 ids escolhidos à mão, todos com vetor, de gêneros variados e reconhecíveis. Um teste confere que todos têm vetor e são visíveis. |
| `PATCH /perfis/:id` | `{ nome?, onboardingConcluido? }` | perfil |
| `DELETE /perfis/:id` | — | `204`, com cascata |
| `GET /perfis/:id/onboarding` | `q?`, `genero?`, `cursor?` | Grade **curada**: na primeira página, para cada um dos 18 gêneros reais (sem "unknown"), os 2 filmes visíveis com vetor de maior `n_notas` do gênero, sem repetir, ordenados por `n_notas` decrescente e id. Depois vêm os demais filmes visíveis com vetor, por `n_notas` decrescente e id, paginados por cursor (`n_notas`, `id`), 24 por página. Os filmes **interagidos continuam na grade** com o estado. Com `q` ou `genero`, filtra o mesmo conjunto. |
| `PUT /perfis/:id/interacoes/:filmeId` | `{ tipo: 'gostei' }` \| `{ tipo: 'quero_assistir' }` \| `{ tipo: 'nota', nota: 1..5 }` | Upsert em que a última ação vence. Devolve `{ interacao, anterior: { tipo, nota } \| null, filme: { temVetor }, efeitos }`. O `anterior` alimenta o "Desfazer". `efeitos = { contribuiParaPerfil, excluidoDasRecomendacoes, perfilMudou }`, onde `contribuiParaPerfil = temVetor && (tipo = 'gostei' \|\| nota ≥ 4)`, calculado pela **mesma função** que define `curtidos` em `s1.js`; `excluidoDasRecomendacoes = true`; e `perfilMudou = contribuiParaPerfil ≠ contribuia(anterior)`, com `contribuia(null) = false`. |
| `DELETE /perfis/:id/interacoes/:filmeId` | — | `200 { anterior, efeitos: { contribuiParaPerfil: false, excluidoDasRecomendacoes: false, perfilMudou: contribuia(anterior) } }` (para "Desfazer"); o filme volta a "nenhum" e pode voltar às recomendações |
| `GET /perfis/:id/interacoes` | `tipos?` (lista separada por vírgula de `nota`, `gostei`, `quero_assistir`), `pagina` | itens com `CartaoFilme` e `atualizadoEm`, do mais recente para o mais antigo |
| `GET /perfis/:id/recomendacoes` | — | `Recomendacoes` (abaixo). Ignora qualquer parâmetro de consulta (`?modo`, `?m`). |
| `GET /filmes` | `q?`, `genero?`, `ordem` (`mais_avaliados`, `mais_bem_avaliados`, `titulo`, `ano`), `pagina`, `perfilId?`, `soInfluenciam?` (= só filmes com `temVetor`) | 24 por página, só visíveis: `{ itens, total, pagina }` |
| `GET /filmes/:id` | `perfilId?` | `DetalheFilme`. Filme oculto ou inexistente: `404`. |
| `GET /generos` | — | os 18 gêneros com rótulo em português, mais "Desconhecido" |
| `GET /diagnostico/busca` | `perfilId` | Só com `APP_DIAGNOSTICO=1`, senão `404 ROTA_NAO_ENCONTRADA`. Devolve as listas HNSW e exata e a sobreposição. |

### 6.3 Tipos
```
Midia         = { cartaz: { tipo: 'gerado' } | { tipo: 'externo', url, largura, altura },
                  sinopse: string|null, atribuicao: { texto, url, logo }|null }   // etapa 1: gerado/null/null
CartaoFilme   = { id, titulo, tituloOriginal, ano, generos, temVetor, midia,
                  estadoPerfil: null | { tipo, nota } }
DetalheFilme  = CartaoFilme & { temGemeoOculto: boolean,
                  estatisticas: { movielens:  { nNotas, media|null, pctAprovacao|null, poucasNotas },
                                  computador: { nNotas, media|null, poucasNotas },
                                  sua: { tipo, nota } | null } }
Recomendacoes = { perfilId, geradoEm,
                  motivo: 'personalizado'|'parcial'|'sem_semelhantes'|'sem_curtidas'|'curtidas_sem_vetor',
                  perfil: { curtidos, curtidosComVetor, baseadoEm: [{ id, titulo, ano, generos }] },  // até 5 curtidos com vetor; ano e generos como no CartaoFilme (a mini-capa usa a cor do cartaz)
                  itens: [{ posicao, fonte: 'S1'|'populares', escore: number|null,
                            porque: [{ id, titulo }],    // S1: 1 ou 2; populares: []
                            filme: CartaoFilme }],
                  busca: { mecanismo: 'S1/HNSW', m: 300, nFc: 150,
                           linhasPedidas: number|null, empateNaoResolvido: boolean|null,
                           candidatosS1: number, nExcluidos: number } }   // null quando não houve busca
```

## 7. Frontend (React + Vite, `lang="pt-BR"`, títulos com `lang="en"`)

**Regras gerais:**
- O perfil ativo fica no `localStorage`, dentro de try/catch. Um `404 PERFIL_NAO_ENCONTRADO` limpa o perfil ativo e volta para "Quem está usando?".
- Sem CSS-in-JS em tempo de execução, por causa da CSP `style-src 'self'`.
- Toda falha de rede mostra "Não consegui falar com o servidor local. Ele está rodando?", com o botão "Tentar de novo".
- Os carregamentos usam esqueletos de cartões. Depois de 5 s aparece "Demorando mais que o normal…".

| Componente | Conteúdo |
|---|---|
| `Moldura` | cabeçalho (perfil ativo, Top 10, Catálogo, Minha lista, Minhas avaliações, Sobre), que vira menu abaixo de 640 px; rodapé curto ("Projeto acadêmico · dados MovieLens 100K (GroupLens) · Sobre") |
| `TelaPreparando` | aparece enquanto `/saude` não está `operante`: etapa N de M, a mensagem e uma barra de progresso. Em `falhou` ou `bloqueado`, mostra a causa em português, o comando e o botão **"Conferir de novo"**. Em qualquer estado não operante, quando `/saude` traz `perfis.disponivel = true`, mostra também o link **"Apagar perfis e avaliações"**, que abre a `GestaoPerfisRestrita`. Quando é `false`, mostra "Agora não é possível apagar perfis: <motivo>. Para apagar tudo, use `docker compose down -v` (isso também apaga a preparação)." Faz polling de `/saude` a cada 2 s. |
| `GestaoPerfisRestrita` | Lista os perfis (`GET /perfis`) e permite **só** excluir, com a mesma confirmação da `TelaPerfis`. Não permite criar, renomear nem entrar num perfil. Volta à `TelaPreparando`. |
| `TelaPerfis` | "Quem está usando?", com o aviso fixo "Os perfis ficam só neste computador e não têm senha." Campo **"Apelido"**. Botão **"Ver um exemplo"** (`POST /perfis/exemplo`). Renomear e excluir com confirmação ("Apagar remove as avaliações deste perfil"). |
| `Onboarding` | Começa com "Marque filmes que você já viu e gostou. Cada um já muda as suas recomendações; sugerimos pelo menos 3, para que a lista não dependa de um filme só. O catálogo vai até 1998." Grade curada com o `ControleRapido` (abaixo), busca e filtro de gênero, e "Não reconheço nenhum: mostrar outros", que avança o cursor. O botão principal "Ver minhas recomendações" fica em destaque a partir de 3 filmes curtidos com vetor (`curtidosComVetor`). Com menos, aparece "N marcados · sugerimos pelo menos 3", e o botão continua disponível. Com 0, ele diz "Pular por enquanto". O 3 é só uma orientação: nenhum limiar de qualidade foi medido. |
| `ControleRapido` (cartão) | Um botão "Gostei" (`aria-pressed`) e um menu "…" com "Quero assistir" e "Dar nota". Isso reduz as paradas de Tab. |
| `ControleInteracao` (detalhe) | As estrelas 1–5 (`radiogroup`, rótulo "N de 5 estrelas"; clicar na estrela atual remove a nota), "Gostei", "Quero assistir" e "Remover". Mostra o estado único atual e um texto fixo: "**Gostei** e notas **4 ou 5** contam igual: dizem do que você gosta. Notas **1 a 3** e **Quero assistir** só tiram o filme das suas recomendações, sem mudar o que é sugerido a partir do resto." (texto aprovado pelo usuário em 2026-11-20, no lugar do anterior) |
| `AvisoAcao` (`aria-live`, uma única região, compartilhada com o anúncio do `Top10`) | Depois de todo PUT ou DELETE: "Salvo" e, quando havia estado anterior diferente, "Sua nota 2 foi substituída por Gostei · **Desfazer**". O aviso dura 6 s e não é recriado quando o Top 10 se atualiza; "Desfazer" reaplica o `anterior`. Acrescenta uma frase escolhida por `efeitos`, `tipo`, `nota` e `temVetor`: |

**Frases do `AvisoAcao`:**
- `perfilMudou` e `contribuiParaPerfil`: "Este filme agora conta para as suas recomendações."
- `perfilMudou` sem `contribuiParaPerfil` (PUT): "Este filme deixou de contar para as suas recomendações e não aparece nelas enquanto estiver marcado."
- Nota 1–3 sem mudança de perfil: "Notas 1–3 tiram este filme das recomendações, mas não afastam filmes parecidos." (sem o "ainda", decisão do usuário em 2026-11-20)
- Filme sem vetor, com "Gostei" ou nota 4–5: "Este filme é raro nos dados de 1998 e não entra no cálculo dos seus gostos."
- "Quero assistir": "Ele não aparece nas recomendações enquanto estiver na Minha lista."
- `DELETE`: "Este filme pode voltar a aparecer nas recomendações." Com `perfilMudou`, antes vem "Ele deixou de contar para os seus gostos."

| Componente | Conteúdo |
|---|---|
| `Catalogo` | `BarraBusca` (texto, gênero, ordem, "Só filmes que ajudam a recomendar"), uma `GradeFilmes` com "Carregar mais", o `CartaoFilme` com o selo discreto "curtir não personaliza" quando não há vetor, e a busca vazia: "Nada encontrado. O MovieLens 100K só tem filmes até 1998." |
| `DetalheFilme` | `Cartaz` grande, título de exibição (com o original abaixo quando diferente), ano, gêneros, `ControleInteracao` e `PainelEstatisticas`: "MovieLens (1997–98, 943 pessoas)" com média, número de notas e "% de notas 4–5" (com dica), e "Neste computador", recolhido até ter 5 notas, com o rótulo cinza "poucas notas ainda". "Sua nota" vem separada. Se houver gêmeo oculto, mostra a nota da §5.1. |
| `Top10` | "Baseado em: [até 5 curtidos]" e "N dos seus M filmes curtidos estão sendo usados". `ListaRecomendacoes` numerada. Cada item S1 traz "Porque você curtiu *X*" (e *Y*), e cada popular traz o selo "**Mais avaliados nos dados de 1998**" com uma dica explicando. A `ExplicacaoMotivo` vem abaixo. A lista **se atualiza sozinha** depois de cada interação (ver "Atualização automática do Top 10" abaixo). |
| `MinhaLista` | os "Quero assistir", com "Já assisti: avaliar" e "Remover da lista" |
| `MinhasAvaliacoes` | as notas e os "Gostei", com edição e exclusão (`tipos=nota,gostei`) |
| `Sobre` | Em camadas. **No topo, em 3 frases:** "O sistema compara seus gostos com avaliações de 943 pessoas feitas em 1997–98. Para testar a técnica, foram separadas algumas avaliações históricas de 445 dessas pessoas. Os resultados medidos não garantem a mesma qualidade para novos usuários." **"O que foi medido":** o resultado principal do Plano 3, com os números de `/sobre`. Eles vêm de constantes em `app/integridade.js` que um teste do CI confere contra `git show 6077974:resultados/avaliacao-v2.json`. A tela mostra também o método e "o que isso não significa". **"Detalhes técnicos"**, recolhido: a S1, o HNSW, M = 300 e FC150, a exclusão da aplicação, o índice reconstruído e os hashes. Também traz os limites (catálogo até 1998, sem sinal negativo), as licenças, a citação e o link para o README da pesquisa. |
| `Cartaz` | ver abaixo |

**Atualização automática do Top 10:**
- O `Top10` sempre busca `GET /recomendacoes` ao abrir, sem cache no cliente (`cache: 'no-store'`). Qualquer escrita invalida o Top 10, de modo que uma interação feita no catálogo ou no detalhe aparece quando a pessoa volta a ele.
- Depois de uma interação feita na própria tela:
  1. O item marcado sai com uma animação curta (≤ 200 ms). A lista ganha `aria-busy="true"` e um indicador discreto "Atualizando…", sem esconder os outros itens.
  2. Quando a escrita termina, o cliente pede `GET /recomendacoes` e troca a lista. Os itens que continuam mantêm a chave (`filme.id`) e deslizam até a nova posição (FLIP, ≤ 300 ms). Os que entram aparecem com fade e o selo "Novo". Com `prefers-reduced-motion: reduce`, a troca é instantânea.
  3. **"Novo"** é o item ausente da lista que estava carregada quando a pessoa abriu a tela. Por isso um filme que volta pelo "Desfazer" não ganha o selo.
  4. **Sequência:**
     - as escritas do mesmo filme vão em fila, na ordem dos cliques;
     - cada escrita incrementa um contador `seq`. O `GET` só sai quando não há escrita pendente; uma resposta com `seq` ultrapassado é descartada, e o `GET` anterior é abortado (`AbortController`);
     - cliques rápidos produzem uma única troca final.
  5. **Acessibilidade:** o resultado é anunciado na mesma região `aria-live` do `AvisoAcao`, por exemplo "Salvo. Recomendações atualizadas: 1 filme novo, *Título*". O foco nunca cai no `body`: se estava no item que sai, vai para o item na mesma posição (ou para o anterior, ou para o título da lista, com `tabindex="-1"`).
  6. O **"Desfazer"** é uma escrita como as outras.
  7. Se o `GET` falhar, a lista fica como está e aparece "Não consegui atualizar as recomendações · Tentar de novo". É a única faixa com botão.

**Componente `Cartaz`:** gera um SVG 2:3 determinístico.
- O fundo é um gradiente de 2 cores, com o matiz derivado de um hash do id dentro da família de cores do primeiro gênero, mais um padrão geométrico simples também derivado do hash.
- O título de exibição vem em até 3 linhas, com reticências, e o ano aparece pequeno.
- O contraste do texto é ≥ 4,5:1, **calculado**, e escolhe texto claro ou escuro.
- Tem cantos arredondados e sombra.
- É acessível como `role="img"` com `aria-label="Cartaz: <título> (<ano>)"`.
- Com mídia externa (etapa 2), usa `<img loading="lazy" referrerpolicy="no-referrer">`; no `onerror`, cai para o SVG.

**Textos de `ExplicacaoMotivo`:**
- `personalizado`: "Filmes curtidos por pessoas que curtiram os mesmos filmes que você."
- `parcial`: "Encontramos menos de 10 filmes parecidos com seus gostos; completamos com os mais avaliados nos dados de 1998."
- `sem_semelhantes`: "Não encontramos filmes parecidos que você ainda não tenha marcado; mostramos os mais avaliados."
- `sem_curtidas`: "Você ainda não marcou filmes de que gostou. Enquanto isso, mostramos os mais avaliados. Marque alguns como 'Gostei' ou dê 4–5 estrelas."
- `curtidas_sem_vetor`: "Os filmes que você curtiu são raros nos dados de 1998. Experimente curtir títulos mais conhecidos."

**Acessibilidade:**
- foco visível;
- alvos de pelo menos 44 px;
- selos que não dependem só de cor;
- contraste AA;
- funciona a partir de 360 px.

**CSP** (helmet configurado explicitamente, `useDefaults: false`, `hsts: false`, sem `upgrade-insecure-requests`):

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;
object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'
```

Na etapa 1 **não há nenhuma requisição externa** em tempo de execução.

## 8. Instalação local

**Pré-requisitos:**
- Docker Desktop (Windows ou Mac) ou Docker Engine ≥ 28 com o Compose v2 (Linux);
- cerca de 3 GB livres;
- internet na primeira vez: cerca de 1 GB entre imagens e pacotes, mais 5 MB de dados. Depois funciona offline.

Não precisa de Node, de chave nem de `.env`.

```
git clone https://github.com/<conta>/recomendacao-filmes.git
cd recomendacao-filmes/app
docker compose up --build
# abra http://localhost:3000 — a página mostra o progresso da preparação
# (primeira vez: tempo medido e informado no README; depois, segundos)
```

- **Parar e retomar:** `Ctrl+C`, depois `docker compose up`.
- **Apagar tudo:** `docker compose down -v`.
- **Refazer a preparação:** `docker compose run --rm preparar`, e depois "Conferir de novo" na página.
- **Porta ocupada:**
  - crie `app/.env` com `APP_PORTA=3001`;
  - ou rode `$env:APP_PORTA=3001; docker compose up` no PowerShell;
  - ou rode `APP_PORTA=3001 docker compose up` no bash.
- **Sem internet ou atrás de proxy:** a falha aparece no build (pacotes) ou na preparação (dados). O README mostra as duas mensagens e a opção de zip local (`compose.local-zip.yml`).

**Documentação:**
- O guia da aplicação fica em `app/README.md`.
- O README da raiz ganha só, no topo, uma seção curta com o GIF (60 a 90 s), 4 a 6 capturas com cartazes gerados, uma frase sobre por que não há site público e o link para `app/README.md`. Os números da pesquisa no README não mudam. A revisão completa e acessível do README fica para o fim do projeto.

**Arquivos novos fora de `app/`:**
- `.dockerignore`, a lista de permissão da §4.1;
- `.github/workflows/app.yml`;
- linhas no `.gitignore`: `test-results/`, `playwright-report/`, `blob-report/`, `playwright/.cache/`, `coverage/`, `*.tsbuildinfo`, `app/compose.dev.override.yml`.

O Playwright e o Vitest gravam só nessas pastas.

**Modo de desenvolvimento:** `docker compose -f compose.yml -f compose.dev.yml up db`.
- O `compose.dev.yml` declara o projeto Compose `recomendacao-dev` (volume próprio) e publica o banco em `127.0.0.1:5434`. Desenvolvimento e testes usam só esse projeto; o nome `recomendacao-app` fica para a instalação real, que nunca recebe testes nem `down -v` de desenvolvimento.
- O nome não é carregado automaticamente: **nunca** use `compose.override.yml`.
- `npm run dev` em `app/` aponta para esse banco. A preparação recusa o banco da pesquisa (§4.2, passo 3).
- O servidor de desenvolvimento do Vite faz proxy de `/api` para `http://localhost:3000`, com `changeOrigin: true` e o cabeçalho `Origin` reescrito para `http://localhost:3000`. Em desenvolvimento, `APP_PORTA=3000`. Assim, a validação de `Host` e `Origin` não precisa de exceção para desenvolvimento.

**O que não é tocado:** `src/`, `scripts/`, `package.json`, `package-lock.json`, `resultados/`, `docker-compose.yml` e `.env.example` da raiz, nem o banco e os `artefatos/` da pesquisa.

## 9. Segurança e privacidade
- **Rede:** a publicação é só em `127.0.0.1`. O README pede Docker ≥ 28 no Linux, porque versões anteriores expunham portas de loopback na rede local, e avisa para não expor a aplicação, que não tem senha.
- **Navegador:** `Host` em lista de permissão, `Origin`/`Sec-Fetch-Site` nas escritas, sem CORS, sem o parser `text/plain` e com a CSP explícita (§6.1, §7).
- **LGPD:**
  - coleta só um apelido e as interações; sem e-mail e sem telemetria;
  - não faz requisição externa em tempo de execução;
  - excluir o perfil apaga tudo, e isso funciona até no modo bloqueado.
- **Banco:** papéis com mínimo privilégio, senhas aleatórias fora do repositório, SQL só com parâmetros (com a única exceção declarada do `ALTER ROLE … PASSWORD`, §4.2, passo 5) e schemas como constantes.
- **Segredos:** separados do estado (`credenciais.json`), nunca nas respostas da API nem nos logs.
- **Imagem:** roda como `node`, sem segredos, por causa do `.dockerignore`, conferido no CI.
- **Diagnóstico:** a rota fica desligada por padrão.

## 10. Isolamento da pesquisa e reprodutibilidade

1. **Teste de imports com parser** (`app/testes/isolamento.test.js`):
   - Usa `es-module-lexer` ou `acorn` para coletar `import`, `export … from`, `import()` e `require`/`createRequire` em todo `app/` (menos `node_modules` e `dist`).
   - **Falha** com:
     - `import()` de especificador não literal;
     - qualquer `createRequire`;
     - `@tensorflow/*`;
     - `src/modelo/*`, `src/avaliacao/*` (exceto a lista do item 3), `src/dados/{carregar,leitura,estatisticas,teste2,divisoes}.js` importados **diretamente**;
     - as strings `incluirTeste`, `incluirTeste2`, `u1.test`, `u.data`, `.test'`, `ua.` e `ub.`.
   - **Imports diretos permitidos da raiz:**
     - `app/servidor/` só `src/banco/busca-fc.js`, `src/fc/referencia.js` e `src/candidatos/populares.js`;
     - `app/preparar/` só `src/contexto.js`, `src/dados/download.js`, `src/fc/referencia.js` e `src/candidatos/populares.js`, mais o script 16 como subprocesso;
     - `app/servidor/recomendacao/` não importa `app/servidor/midia/`.
2. **Auditoria do fecho em tempo de execução:**
   - Um teste sobe o servidor com um hook `module.register` que registra toda URL resolvida e confere que o fecho **transitivo** do servidor **não** contém `src/contexto.js`, `src/dados/*`, `src/avaliacao/*`, `src/modelo/*` nem `@tensorflow`.
   - Para a preparação, o fecho tem de ser exatamente o conjunto auditado, registrado como lista no teste, e esse conjunto tem de estar contido no fecho do script 16 (16 arquivos de `src/`) mais `src/candidatos/populares.js` e `src/dados/download.js`.
3. **Exceções nomeadas para testes:**
   - `app/testes/referencia/` pode importar `src/contexto.js` e `src/avaliacao/fidelidade.js`;
   - `app/testes/determinismo/` pode importar `src/contexto.js` e `src/util/hash-avaliacoes.js`.

   As duas continuam proibidas de usar `incluirTeste*`.
4. **Congelamento no CI:**
   - checkout com `fetch-depth: 0`;
   - os comandos rodam com `git -C "$(git rev-parse --show-toplevel)"` e pathspecs `:/…`:
     - `git diff --exit-code c048537911c14313c4e85c516270513871a14a88 HEAD -- :/src :/scripts :/package.json :/package-lock.json`;
     - `git diff --exit-code 6077974fb015c31c870eb5c4995a3a6f45682ca7 HEAD -- :/resultados`;
     - `git show 6077974:resultados/configuracao-v2.json` comparado com as constantes de `app/integridade.js`;
   - **sem resíduos:** o retrato de `git status --porcelain` depois da suíte é igual ao de antes, de modo que nenhum teste cria um arquivo fora das pastas ignoradas; depois do commit de cada tarefa, a árvore fica limpa. Os dois critérios são distintos (ver o plano, "Árvore git").
5. **Equivalência com a referência, em duas camadas:**
   - **(a) Lógica, com igualdade exata:** o pipeline `s1.js`, com a função de busca **injetada** devolvendo `rankingReferencia(fc, perfil, new Set(excluir), M)` em memória, sobre `construirFC(ctx.treino, 943)`, comparado com uma referência independente escrita no teste: os 10 primeiros de `rankingReferencia`, mais o preenchimento por `rankingPopularidade(regua.contagens)`, mais as mesmas exclusões. Ids, escores, `fonte` e `motivo` têm de ser idênticos. São 30 perfis sintéticos com semente fixa e de 0 a 15 curtidos, incluindo curtidos sem vetor, gêmeos, perfis com déficit e um perfil que esgota os candidatos.
   - **(b) Precisão, contra o banco em modo exato:** os mesmos perfis com `modo: 'exata'` (só neste teste, por um parâmetro interno), avaliados pelas regras de `conferirPrecisao`/`conferirExataUsuario` com τ = 1e-5. Os escores precisam bater dentro de 1e-6 + 1e-12. O teste registra o número de divergências de precisão aceitas, como no Plano 3.
   - **HNSW:** nunca é comparado com uma lista fixa. Só se conferem as invariantes: no máximo K itens, sem `excluir`, escores S1 decrescentes e > 0, e `fonte`/`motivo` coerentes.
6. **Integridade com o servidor já operante**, num banco descartável e com o servidor no estado **operante** antes de cada adulteração:
   - **(a) Hash:** `UPDATE v2_final.metadados SET valor = 'x' WHERE chave = 'hash_treino'`. O pedido seguinte de `/recomendacoes` recebe `503 BLOQUEADO`, sem esperar a vigia, e o `/saude` mostra `bloqueado` com a causa "treino".
   - **(b) Valores dos vetores:** com `APP_VIGIA_SEGUNDOS=1` e `APP_VIGIA_CONTEUDO_A_CADA=1`, um `UPDATE` muda um componente não nulo de um vetor de `filmes_fc`, preservando o suporte e os hashes. Em até 10 s, o `/saude` mostra `bloqueado` com a causa "valores dos vetores".
   - **(c) Nova preparação legítima:** rodar o script 16 de novo, o que troca os OIDs. A vigia dispara a reconferência integral, que passa, e o servidor continua `operante` com o `fc` recarregado.
   - **(d) Padrões:** um teste de unidade confere que os padrões são 60 s e 10 ciclos.
   - Depois de (a) e (b), restaurar os valores, chamar "Conferir de novo" (`/saude`) e conferir `operante`.
   - **Exclusão de perfis fora do estado operante:**
     - no estado `bloqueado` de (a), `GET /perfis` responde 200, e `DELETE /perfis/:id` responde 204 e apaga as interações em cascata;
     - com o `db` parado, `/saude` traz `perfis.disponivel = false` e `motivo = 'banco_indisponivel'`, e o `DELETE` responde `503 BANCO_INDISPONIVEL`;
     - com `credenciais.json` adulterado, o motivo é `'credenciais'`;
     - o Playwright cobre o caminho na interface: bloqueado → "Apagar perfis e avaliações" → excluir → o perfil some.
   - um terceiro caso derruba o `db` (`docker compose restart db`) e confere `503 BANCO_INDISPONIVEL` seguido da volta a `operante` sem reiniciar o `app`.
7. **Determinismo entre plataformas:** um job em Windows, macOS e Linux, sem Docker:
   - `npm ci --ignore-scripts`;
   - baixa o ML-100K, guardado em cache pelo sha256;
   - confere o sha256 dos 5 arquivos;
   - calcula `regua.hash`, `hashAvaliacoes(treino)` e `hashVetoresFC(construirFC(treino, 943))` e os compara com as constantes.
8. **`u1.base` e teste-2:**
   - O `u1.base` contém as notas das quais o teste-2 foi derivado. A preparação o lê inteiro, mas `criarContexto({ fase: 'v2-final' })` separa o teste-2 em memória (`dividirTeste2`) e o retira do treino. Sem `incluirTeste2`, `alvos` vem `null`, o que é conferido por `assert` (§4.2, passo 6).
   - Os alvos escondidos nunca chegam à aplicação como gabarito: nada deles é gravado no banco ou no estado.
   - O volume com o `u1.base` (`app_dados_ml`) é montado só no `preparar`, nunca no `app` (§4.1).
   - O README da aplicação traz uma frase equivalente.
9. **Tag:** `pesquisa-plano3-final` em `6077974` é criada localmente antes do primeiro commit de código. O push só acontece com autorização do usuário, e o CI não depende dela.

## 11. Mídia: arquitetura agora, fornecedor depois

### 11.1 Etapa 1
- `app/servidor/midia/` tem a interface `midia(filme) → Midia` e o registro `MIDIA_FORNECEDOR` (padrão `local`). Só existe o fornecedor `local`: o SVG gerado é o padrão, não um substituto provisório. Um valor desconhecido em `MIDIA_FORNECEDOR` é recusado com uma mensagem de erro, e nenhum adaptador TMDB existe no código.
- O frontend já trata `externo`, o `onerror`, a atribuição e o `referrerpolicy`. A CSP recebe a origem do fornecedor por configuração.
- Nenhum dado de mídia entra no recomendador, e o teste da §10.1 garante isso.

### 11.2 Etapa 2 (requisitos decididos, não implementados)
- **TMDB: não implementar nem disponibilizar como adaptador, nem mesmo ativável por chave pessoal.**
  - Os "API Terms of Use" do TMDB (atualizados em 20/10/2023, https://www.themoviedb.org/documentation/api/terms-of-use), na seção 1.C, proíbem: "Use the TMDB APIs or TMDB Content in connection with, including for training, a machine learning (ML) or artificial intelligence (AI) based Application." A seção 1.A reserva ao TMDB o uso "in connection with, or for training, a machine learning or artificial intelligence based Application".
  - Esta aplicação é um recomendador por filtragem colaborativa, uma técnica de aprendizado de máquina. A restrição vale "in connection with", ou seja, vai além do treinamento.
  - Não se presume exceção por uso acadêmico, por ausência de monetização, pela chave ser da própria pessoa ou pela separação entre a interface e o recomendador. O FAQ sobre uso não comercial não afasta a seção 1.C.
  - O usuário pretende pedir esclarecimento por escrito ao TMDB. Só uma autorização expressa e aplicável reabre este item, e com uma nova decisão.
- **Outro fornecedor:** pode entrar no futuro pela interface da §11.1, se a licença for comprovadamente compatível com um recomendador acadêmico baseado em ML. Os candidatos já descartados são o Cinemeta/MetaHub (termos restritos ao Stremio; licença que não autoriza exibir imagens) e o TMDB (seção 1.C).
- **A etapa 1 não espera** nenhuma integração visual externa.
- **Mapeamento MovieLens → IMDb/TMDB:** gerado na máquina de quem roda, por **ação explícita** (`docker compose run --rm mapear`). É opcional, não bloqueante e independente de qualquer fornecedor de mídia.
  - Os ids vêm do `links.csv` da GroupLens, e nenhuma API do TMDB é chamada.
  - Antes de implementar, verificam-se as condições de uso das fontes (a licença dos datasets `ml-latest`). Ter um TMDB ID guardado não autoriza o uso da API do TMDB.
  - **Padrão:** o `ml-latest-small`, com 1.335 de 1.682 filmes (79,4%) na prova de conceito.
  - **`--completo`:** o `ml-latest`, com 1.637 (97,3%), extraindo só `movies.csv` e `links.csv` (cerca de 2,5 MB) por HTTP Range. Sem suporte a Range, o comando pede confirmação antes de baixar o zip inteiro.
  - **Registro:** a URL, o ETag ou Last-Modified, o sha256 dos CSVs e a data vão para `origem_versao`, junto com um relatório de correspondências.
  - **Regras conservadoras:** só título e ano exatos são aceitos automaticamente. Os demais casos ficam pendentes até uma decisão manual, registrada num arquivo versionado de ids com a justificativa. Os gêmeos herdam o id do canônico, e o 267 nunca é associado.
  - **Validação objetiva:**
    - 100% dos casos não exatos auditados contra a página do IMDb;
    - mais uma amostra aleatória estratificada dos exatos;
    - erros relatados com limite superior de Clopper-Pearson a 95%.

    A estimativa de 0,1% a 0,5% da prova de conceito **não** é aceita como resultado.

## 12. Testes

| Nível | Ferramenta | Cobertura |
|---|---|---|
| Unidade | `node:test` | estado único, precedência e `anterior`; `efeitos` (inclusive `perfilMudou` em "Gostei" → nota 2 e no DELETE; `contribuiParaPerfil` ⇔ o filme está em `curtidos(P)` e tem vetor); `curtidos`/`interagidos`/`OCULTOS`; preenchimento; os cinco `motivo`; `porque` (exclusão da contribuição 0, ordem pela contribuição normalizada, incluindo um caso em que a interseção crua e a normalizada discordam, desempate por id, e pelo menos 1 explicação por item S1); suficiência (n = 4 → `null`, n = 5 → média); exclusão dos perfis de exemplo das estatísticas; `titulo_exibicao`; o `Cartaz` determinístico e o contraste calculado |
| Isolamento e congelamento | `node:test` + CI | §10.1 a §10.4 |
| Integração (banco real) | `node:test` | migrações idempotentes; selo; papéis (`app_escrita` não escreve em `v2_final`; `app_leitura` não escreve; `current_schema()` = `v2_final` no pool de leitura; `buscarColaborativos` funciona com `app_leitura`; GRANTs sobrevivem a uma nova execução do script 16); §10.5 e §10.6; todas as rotas e o catálogo de códigos; `421`, `403` e `415`; o limite de 20 com POSTs concorrentes; o `/diagnostico` com 404 sem a variável; recomendações ignorando `?modo`/`?m`; os cabeçalhos exatos da CSP e a ausência de HSTS; **porta alternativa**: o Compose sobe com `APP_PORTA=3317`, e então `Host: localhost:3317`, `127.0.0.1:3317` e `[::1]:3317` recebem 200 em `/api/saude`, enquanto `Host: localhost:3000` recebe 421, e a linha "Pronto" da preparação mostra a 3317; **segredos**: o valor das duas senhas de `credenciais.json` não aparece em nenhuma resposta da suíte de contrato, nas requisições e respostas do Playwright (capturadas em memória, sem arquivo HAR, porque o HAR só é gravado depois da desmontagem das fixtures), no `estado.json` nem em `docker compose logs` dos três serviços. A execução forçada com `ALTER ROLE` que falha **não** é coberta pelo e2e (lacuna declarada); `28P01` (credenciais trocadas no arquivo) leva ao bloqueio com a causa certa, e a reconferência recupera depois de uma nova preparação |
| Componentes | Vitest + Testing Library | `Top10` (resposta antiga que chega depois da nova é descartada, com fetch simulado com atrasos; foco ao remover o item focado; `prefers-reduced-motion`), `ControleInteracao`, `AvisoAcao` com "Desfazer" e as frases por `efeitos`, `PainelEstatisticas`, `ExplicacaoMotivo`, `Cartaz` (o fallback de `onerror`), `TelaPreparando` |
| Ponta a ponta | Playwright, em **Chromium e WebKit**, `baseURL http://127.0.0.1:<porta>` | O fluxo principal: criar perfil → onboarding com 3 "Gostei" → Top 10 com 10 itens S1 e "Porque você curtiu" → dar 5 estrelas a um item no Top 10 (ele sai; **sem nenhum clique**, a lista volta a ter 10 itens, há um item com o selo "Novo" e o foco fica num item da lista) → dar notas a dois itens em seguida, sem esperar (a lista final não contém nenhum dos dois e tem 10 itens) → dar nota 2 a um item (ele sai do Top 10) → "Quero assistir" em outro item (ele vai para a Minha lista e não volta ao Top 10) → trocar a nota 2 por "Gostei" e usar o "Desfazer" → excluir a nota (o estado volta a "nenhum"). Também: o "Ver um exemplo" mostra o Top 10; um perfil vazio recebe populares com explicação; navegação por teclado nas estrelas; **nenhuma requisição fora de localhost** em todo o fluxo. |
| Instalação limpa | GitHub Actions (Linux) | §13, critério 1 |
| Multiplataforma | GitHub Actions | §10.7, mais o `buildx` amd64/arm64 da imagem |

## 13. Critérios de aceite

1. **Instalação limpa**, com o mesmo peso dos demais. Uma pessoa clona o repositório em outro computador, segue o README, prepara o banco e abre a aplicação, sem nenhum arquivo privado e sem chave de serviço externo.
   - **Automática (CI, Linux):**
     - checkout numa pasta nova, sem cache de Docker e com volumes novos;
     - `cd app && docker compose up -d --build`;
     - `/api/saude` responde `operante` em até 15 minutos;
     - o log de `preparar` mostra os três hashes iguais às constantes;
     - o fluxo principal do Playwright passa contra o contêiner;
     - os casos negativos e de recuperação da §10.6 são cobertos pela suíte de integração, no job `testes` do CI, e pelo e2e do caminho bloqueado (não pelo job `instalacao-limpa`);
     - `docker compose config` não publica a 5432;
     - a imagem não contém `.env`;
     - `docker compose down -v`.
   - **Manual, antes da entrega:** o mesmo roteiro do README num clone novo, em Windows com Docker Desktop, e, se houver acesso, em Mac ARM. O registro inclui a data, as versões e o tempo medido, que vai para o README.
2. **S1 preservada:** as §10.1, §10.2, §10.4 e §10.5 passam.
3. **Funcionalidades:** os itens 1 a 8 da §1.1, cobertos pelos testes de contrato e pelo Playwright.
4. **Casos-limite testados:**
   - perfil vazio;
   - curtidas só sem vetor;
   - `sem_semelhantes` e déficit;
   - nota baixa;
   - filme sem vetor;
   - gêmeos e o 267;
   - hash divergente;
   - banco reiniciado;
   - preparação interrompida, com o selo ausente;
   - DNS rebinding;
   - porta alternativa.
5. **Sem requisição externa** em tempo de execução.
6. **Comunicação honesta:** a tela Sobre e o README dizem o que foi medido, com quem, e o que não se transfere. O README declara a exclusão própria da aplicação e o índice reconstruído.
7. **Licenças e dados:**
   - O repositório não redistribui os arquivos originais do MovieLens nem registros individuais: nenhuma avaliação individual, dado demográfico ou informação que permita reconstruir registros. A aplicação (`app/`) também não traz id de usuário histórico.
   - Exceção anterior à aplicação, registrada em 2026-11-20: os resultados congelados da pesquisa (`resultados/avaliacao-final.json` e `resultados/avaliacao-v2.json`) trazem o NDCG@10 por id anônimo de usuário do MovieLens. Um número por usuário e sistema não permite reconstruir notas. Esses arquivos ficam fora da licença MIT do código e sujeitos aos termos do GroupLens (README, seção "Licença e dados de terceiros").
   - Podem ser publicados resultados agregados do projeto e capturas ilustrativas (`app/docs/capturas/`), desde que o detalhe use um filme com muitas avaliações históricas, só apareçam cartazes gerados localmente e só perfis de demonstração, sem dados pessoais, tokens ou credenciais. Esta regra é uma escolha de cautela do projeto; a spec não afirma que a licença do MovieLens autorize expressamente toda publicação de dados derivados.
   - Nenhum cartaz ou sinopse de terceiros no repositório.
   - A atribuição à GroupLens aparece no app e no README, sem sugerir endosso.

## 14. Decisões tomadas pelo assistente (para revisão do usuário)
- **Perfis locais sem senha, com "Apelido":** escuta só em localhost e proteção por `Host`/`Origin`.
- **Stack:** Fastify, React + Vite, Vitest, Playwright (Chromium e WebKit) e GitHub Actions.
- **O app sobe junto com o banco** e mostra a preparação com progresso e reconferência automática, em vez de esperar o `preparar` ou travar no modo bloqueado.
- **Gêmeos:** só o de menor id aparece em toda a aplicação. O outro e o id 267 entram no conjunto de exclusão. Assim a única mudança em relação à S1 avaliada é o conjunto de exclusão.
- **Onboarding curado:** os 2 mais avaliados de cada gênero, com vetor, e depois a ordem global.
- **"Perfil de exemplo"** com 6 filmes escolhidos à mão. Ele fica fora das estatísticas "Neste computador".
- **"Porque você curtiu X"**, calculado pela contribuição de cada curtido ao escore (fãs em comum, normalizados pela popularidade do curtido). É uma explicação e não altera a ordem.
- **O Top 10 se atualiza sozinho** depois de cada interação, como você pediu ("atualizado na hora"), com transição animada, o selo "Novo", o anúncio por `aria-live` e o foco preservado. A faixa "Atualizar" da v2 foi retirada porque exigia um clique e contrariava esse requisito.
- **Os três sinais continuam,** como você decidiu, com "Desfazer" e textos que dizem o que influencia. A revisão de UX sugeriu fundir "Gostei" com as estrelas e cortar "Quero assistir"; **não acatei, porque contraria a sua decisão**.
- **Títulos exibidos com o artigo no início;** o original aparece no detalhe e conta para a busca.
- **Senhas dos papéis aleatórias,** geradas na preparação. O `.env` é opcional.
- **Limites:** 20 perfis, 24 itens por página, C = 10 na média bayesiana.

## 15. Deixado para quem constrói
- A organização interna de `app/servidor` e dos componentes, respeitando os nomes dos contratos.
- O estilo visual (tipografia, paleta por gênero, padrões do cartaz), com AA.
- O digest da imagem `node:22-bookworm-slim`.
- Os 6 ids do perfil de exemplo, respeitando as regras da §6.2.
- O formato exato dos logs, que precisa incluir as etapas numeradas e os três hashes.

## 16. Mudanças em relação à v1 (origem nas revisões)
- **Reprodutibilidade:**
  - M = 300, com FC150 e top 10 como prefixo (a v1 tinha m = 150, o que mudava o `ef_search`);
  - equivalência em duas camadas, com τ = 1e-5 (a igualdade exata contra o banco era inatingível);
  - extração só dos 5 arquivos, com sha256 por arquivo e zip local opcional;
  - estatísticas geradas de `regua.contagens`, com conferências;
  - conferência dos valores de `filmes_fc`;
  - constantes de integridade conferidas contra `6077974`;
  - pathspecs `:/` e `fetch-depth: 0`;
  - `git status` limpo, com os padrões de teste no `.gitignore`;
  - `cwd` do script 16 no volume e recusa do banco da pesquisa;
  - teste de imports com parser e auditoria do fecho transitivo.
- **Instalação e integração:**
  - healthcheck no `db` e novas tentativas na preparação;
  - pontos de montagem com dono `node`;
  - selo `app.preparacao` e transação única;
  - migrações e papéis sempre aplicados;
  - `ALTER DEFAULT PRIVILEGES`;
  - trava de preparação;
  - app que sobe cedo, com reconferência e distinção entre disponibilidade e integridade;
  - `pool.on('error')` e `restart`;
  - uma única imagem;
  - `.dockerignore` em lista de permissão;
  - `compose.dev.yml` em vez de override automático;
  - lockfile com os binários Linux e `buildx` multiarquitetura;
  - Docker ≥ 28 no Linux.
- **Segurança:** `Host`/`Origin`/`Sec-Fetch-Site`, sem o parser `text/plain`, helmet explícito sem HSTS nem `upgrade-insecure-requests`, e WebKit no Playwright.
- **API:**
  - catálogo de códigos e `/saude` sempre 200;
  - onboarding com `q`, cursor e interagidos visíveis;
  - `curtidos` nas contagens e `tipos` múltiplos;
  - `404` de perfil e de filme oculto;
  - rotas de perfil liberadas no bloqueio;
  - motivo `sem_semelhantes`;
  - `anterior` para desfazer;
  - `porque`, `baseadoEm` e `nExcluidos`.
- **Experiência de uso:**
  - perfil de exemplo, GIF e capturas no README;
  - onboarding curado e aviso de que o catálogo vai até 1998;
  - "Desfazer" e textos sobre o que influencia;
  - Top 10 estável com "Atualizar" e "Novo" (substituído na v3 pela atualização automática);
  - "Porque você curtiu";
  - rótulos mais claros;
  - cartaz com variação e contraste calculado;
  - títulos com o artigo no início;
  - gêmeos ocultos;
  - tela de preparação;
  - "Apelido" e aviso de perfil local;
  - Sobre em camadas;
  - acessibilidade e mobile.

### 16.1 Mudanças da v2 para a v3 (revisão direcionada de 7 pontos)
| Ponto | Classificação | Mudança |
|---|---|---|
| 1. Semântica das avaliações | Confirmado, com ajuste | `influenciaRecomendacoes` foi substituído por `efeitos: { contribuiParaPerfil, excluidoDasRecomendacoes, perfilMudou }` no PUT e no DELETE. Os textos agora dizem que **qualquer** marcação tira o filme das recomendações (igual à avaliação, que excluía todos os vistos) e que notas **1–3**, não só 1–2, ainda não afastam filmes parecidos. O selo do catálogo passou a "curtir não personaliza". O pipeline não mudou. |
| 2. Top 10 na hora | Confirmado | A faixa "Atualizar" saiu. O Top 10 se recalcula sozinho a cada interação, com animação, fila de escritas, contador `seq`/`AbortController`, uma região `aria-live` e foco preservado. O Playwright foi atualizado. |
| 3. Porta e Host | Confirmado | `APP_PORTA` vai em `environment:` do `app` e do `preparar`. O servidor escuta em `0.0.0.0:3000` dentro do contêiner, e o `Host` aceito é o da porta publicada. Há teste de integração com a 3317. |
| 4. Estado e credenciais | Parcialmente procedente | As senhas foram para `credenciais.json` (0600), separado do `estado.json`. O `/saude` é montado campo a campo. O `ALTER ROLE` usa `escapeLiteral`, sem logar a senha. O `28P01` passou a ser classificado. Há teste de vazamento em respostas, HAR, estado e logs. O 0600 é declarado como de pouca proteção, porque os dois contêineres usam o mesmo UID. |
| 5. Textos do onboarding | Confirmado | Os textos não afirmam mais um limiar: cada curtida já muda a lista, e 3 é só uma sugestão. O Sobre dizia "a lista se apoia em poucos filmes"; frase substituída por decisão do usuário em 2026-11-18 pelas 3 frases do resumo do Sobre. |
| 6. "Porque você curtiu" | Confirmado | Só aparecem curtidos com fãs em comum (> 0), ordenados pela contribuição normalizada ao escore, em inteiros exatos. Fica garantida pelo menos 1 explicação por item S1, o que foi provado e é testado. |
| 7. Build e isolamento | Parcialmente procedente | A sintaxe do `.dockerignore` estava correta. O `resultados/` saiu da imagem, e os números do Sobre viraram constantes conferidas no CI. Entraram padrões extras na lista. O lockfile citado passou a ser o de `app/web`. A §10.8 sobre o `u1.base` foi acrescentada, e o `app_dados_ml` fica montado só no `preparar`. |

**Bloqueadores ligados às correções, já resolvidos:**
- o servidor precisava escutar em `0.0.0.0` dentro do contêiner;
- a porta impressa pela preparação;
- o proxy do Vite no modo de desenvolvimento;
- o lockfile do `app/web`;
- a origem dos números do Sobre;
- o `ALTER ROLE` sem parâmetro;
- o código `28P01`.

### 16.2 Mudanças da v3 para a v3.1 (ajustes da aprovação)
- **Exclusão de perfis fora do estado operante:**
  - `GET /perfis` e `DELETE /perfis/:id` ficam liberados;
  - o `/saude` informa `perfis.disponivel` e o motivo;
  - foi acrescentada a tela `GestaoPerfisRestrita`, aberta a partir da `TelaPreparando`;
  - a spec declara os casos em que a exclusão não pode ser garantida (banco indisponível, credenciais recusadas, schema inexistente) e o recurso `down -v`.
- **Integridade com o servidor operante:**
  - a busca já confere os hashes em cada pedido;
  - uma vigia periódica e barata (60 s) lê OIDs, contagem, hashes, selo e estado, e a cada 10 ciclos lê também o resumo do conteúdo;
  - uma divergência dispara a reconferência integral;
  - o limite fica declarado, e os testes (a) a (d) da §10.6 rodam com o servidor já operante.
- **TMDB:** não será implementado nem disponibilizado, nem com chave pessoal, por causa da seção 1.C dos API Terms of Use. O fornecedor local fica como padrão definitivo, e outro fornecedor só entra com licença comprovadamente compatível. O mapeamento de ids continua independente, sem chamar a API do TMDB.
