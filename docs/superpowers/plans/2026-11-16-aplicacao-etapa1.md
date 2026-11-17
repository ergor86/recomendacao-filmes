# Aplicação local sobre a S1 (etapa 1): plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** construir em `app/` uma aplicação local (API, frontend e Docker Compose) em que perfis novos marcam e avaliam filmes do MovieLens 100K e recebem na hora um top 10 da S1 congelada, sem alterar nada da pesquisa.

**Arquitetura:**
- Compose com três serviços:
  - `db`: pgvector, sem porta publicada;
  - `preparar`: roda uma vez, baixa os 5 arquivos, executa o script 16 congelado, migra e confere a integridade;
  - `app`: servidor Fastify que serve a API e o build React, com uma máquina de estados `preparando`/`falhou`/`bloqueado`/`operante`.
- O servidor importa da raiz, só para leitura, `buscarColaborativos`, `perfilFC`, `vetorDeBusca` e `hashVetoresFC`. A lógica de produto (exclusão, preenchimento, explicações, efeitos) fica em `app/servidor/recomendacao/`.

**Stack:** Node 22 (ESM), Fastify 5, `pg` 8, Postgres 17 + pgvector 0.8.1, React 18.3.1 + Vite 5, Vitest 2 + Testing Library, Playwright (Chromium e WebKit), `node:test`, Docker Compose v2, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-16-aplicacao-etapa1-design.md` (v3.1). A spec é a autoridade: este plano a referencia por seção (§) e não repete o que ela já define.

## Restrições globais

- **Nada congelado muda:** `src/`, `scripts/`, `package.json` e `package-lock.json` da raiz, `resultados/`, `docker-compose.yml` e `.env.example` da raiz, o banco e os `artefatos/` da pesquisa.
- **Arquivos proibidos:** nunca ler `u.data`, `u1.test`, `u2..u5.*`, `ua.*` nem `ub.*`. Nunca usar `incluirTeste` ou `incluirTeste2`.
- **Commits:** só no branch `app-etapa1`, **sem push**. Todo commit termina com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Constantes:**
  - `COMMIT_CODIGO` = `c048537911c14313c4e85c516270513871a14a88`;
  - `COMMIT_PESQUISA` = `6077974fb015c31c870eb5c4995a3a6f45682ca7`;
  - hashes `regua` `12119b16edab32568ad1e3e147d793da98b07ec17c46b5f8d695187f91c1521a`, `treino` `ac6c0eacd7ab52a956a07dd948105aee86b354651e106b0a41a0652661ba377a` e `vetoresFC` `08325f426922df6138519c8dc712bd21ad8a5c298f53d5eed1ce249517f44861`;
  - os sha256 dos 5 arquivos (§2 da spec);
  - `N_FILMES = 1682`, `N_FC = 1385`, `DIM_FC = 943`.
- **S1:** `M = 300`, `N_FC = 150`, `K = 10` e `MODO = 'hnsw'` existem **só** em `app/servidor/recomendacao/s1.js`.
- **Isolamento:** só são importados da raiz os módulos que a §10.1 permite, com as exceções de teste da §10.3.
- **Comandos git de conferência:** sempre com `git -C "$(git rev-parse --show-toplevel)"` e pathspecs `:/…`.
- **Árvore git:** dois critérios distintos, que nunca se confundem:
  - **(a) Sem resíduos dos testes:** as suítes gravam saídas só em pastas ignoradas (§8). Os testes que conferem isso comparam o `git status --porcelain` **antes e depois** da execução (um retrato) e falham só se aparecer uma entrada nova criada pelo próprio teste. O trabalho ainda não commitado da tarefa nunca faz um teste falhar.
  - **(b) Árvore limpa depois do commit:** ao fim de cada tarefa, depois do commit, `git status --porcelain` está vazio. Isso é um passo de verificação da tarefa, não um teste automatizado.
- **Congelamento:** a conferência compara a **árvore de trabalho** com o commit congelado (`git diff --exit-code <commit> -- :/src …`, sem `HEAD`). Isso pega alterações commitadas e não commitadas nos caminhos congelados e ignora os arquivos novos da tarefa em `app/`.
- **Idioma:** textos da interface em português (`lang="pt-BR"`), com os títulos dos filmes em `lang="en"`. Os textos fixos (avisos, motivos, frases do `AvisoAcao`) são **copiados literalmente** da spec §7.
- **Rede:** nenhuma requisição externa em tempo de execução. A CSP é a da §7, exatamente.
- **Sem TMDB:** nenhum adaptador TMDB, nenhum código dele e nenhuma variável dele (§11.2).

## Ambiente de desenvolvimento e teste (usado por todas as tarefas)

- **Banco de desenvolvimento e teste:** a partir da tarefa 3, `docker compose -f app/compose.yml -f app/compose.dev.yml up -d db` publica o banco em `127.0.0.1:5434`. Neste computador o Docker roda no WSL Ubuntu; se o daemon estiver parado, ligue com `wsl -d Ubuntu -- sudo service docker start`.
- **Credenciais padrão do superusuário** (definidas em `app/compose.yml`): usuário `recomendacao_app`, senha `app-local-sem-porta-publicada`, banco `recomendacao_app`.
- **Testes de integração:**
  - usam o banco `app_teste`, criado pelo apoio de teste;
  - leem `TESTE_PGHOST` (padrão `127.0.0.1`), `TESTE_PGPORT` (padrão `5434`), `TESTE_PGUSER` e `TESTE_PGPASSWORD` (padrões acima);
  - leem `ML100K_DIR`, a pasta com os 5 arquivos (localmente, `data/ml-100k` da raiz). Só os 5 arquivos são copiados, depois de conferir o sha256.
- **Comandos em `app/`:**
  - `npm test`: unidade, isolamento e congelamento, sem banco;
  - `npm run test:integracao`: com banco, `--test-concurrency=1`;
  - `npm run test:web`: Vitest em `app/web`;
  - `npm run e2e`: Playwright contra um Compose rodando.

## Foco de revisão

Casos que a spec implica mas que nenhum outro teste cobre, com o teste que os fixa:
1. **Títulos latin-1 com acento** (por exemplo, `u.item` com "é"): devem aparecer corretos e ser achados pela busca sem acento. Teste na Tarefa 2 (`tituloBusca`) e na Tarefa 12 (`GET /filmes?q=`).
2. **Apelido só com espaços, com 41 caracteres ou com emoji:** espaços e mais de 40 caracteres dão `400 VALIDACAO`; um emoji dentro de 40 caracteres é aceito. Teste na Tarefa 11.
3. **`localStorage` bloqueado ou com exceção:** a aplicação funciona e volta para "Quem está usando?". Teste na Tarefa 13 (componente `App`).
4. **Perfil apagado em outra aba:** a próxima chamada recebe `404 PERFIL_NAO_ENCONTRADO`, o perfil ativo é limpo e a tela de perfis aparece. Teste na Tarefa 13.
5. **Primeira preparação sem internet:** o estado vai para `falhou`, com a causa em português e o comando do zip local (`compose.local-zip.yml`). Teste na Tarefa 4.

---

## Mapa de arquivos

```
app/
  package.json, package-lock.json      servidor + preparação (fastify, @fastify/helmet, @fastify/static, pg, adm-zip, es-module-lexer)
  integridade.js                       constantes de integridade e números do Plano 3
  Dockerfile, compose.yml, compose.dev.yml, compose.local-zip.yml, README.md
  comum/
    estado.js                          estado.json e credenciais.json (gravação atômica)
    erros-pg.js                        classificarErroPg
    titulos.js                         tituloExibicao, tituloBusca
    gemeos.js                          detectarGemeos, OCULTOS
    fc-banco.js                        carregarFcDoBanco, conferirVetores, impressaoDigital
  banco/migracoes/001_inicial.sql
  preparar/
    index.js                           lê o ambiente → prepararTudo
    preparar.js                        prepararTudo (passos 0–8)
    dados.js                           obterArquivosML
    script16.js                        rodarScript16
    papeis.js                          aplicarPapeis
    referencia.js                      preencherReferencia
    gemeos-manuais.json
  servidor/
    index.js                           lê o ambiente → iniciarServidor
    app.js                             construirApp(deps) → instância Fastify
    seguranca.js                       Host/Origin/415/helmet
    ciclo.js                           máquina de estados, conferência integral, vigia
    pools.js                           criarPools
    exemplo.json
    midia/index.js                     fornecedor local
    recomendacao/s1.js                 recomendar, derivarConjuntos, calcularEfeitos
    recomendacao/explicacao.js         explicar
    rotas/saude.js sobre.js perfis.js interacoes.js onboarding.js filmes.js recomendacoes.js diagnostico.js
  web/                                 React + Vite (package.json próprio)
    src/api.js, src/App.jsx, src/estilos.css, src/telas/*.jsx, src/componentes/*.jsx
  testes/
    unidade/*.test.js, isolamento.test.js, congelamento.test.js, fecho.test.js
    integracao/apoio.js, integracao/*.test.js
    referencia/equivalencia.test.js    exceção nomeada (§10.3)
    determinismo/hashes.test.js        exceção nomeada (§10.3)
    e2e/*.spec.js, playwright.config.js
.dockerignore  .gitignore (linhas novas)  .github/workflows/app.yml  README.md (seção curta no topo)
```

---

### Tarefa 1: Esqueleto, constantes de integridade e travas de congelamento e isolamento

**Arquivos:**
- Criar: `app/package.json`, `app/integridade.js`, `app/testes/congelamento.test.js` e `app/testes/isolamento.test.js`.
- Modificar: `.gitignore` (acrescentar as linhas da §8).
- Criar: `.dockerignore`, com o conteúdo exato da §4.1.

**Interfaces:**
- Produz `app/integridade.js`:
  - `COMMIT_CODIGO`, `COMMIT_PESQUISA`;
  - `HASHES = { regua, treino, vetoresFC }`;
  - `SHA256_ARQUIVOS = { 'u1.base', 'u.item', 'u.user', 'u.genre', 'u.occupation' }`;
  - `N_FILMES`, `N_FC`, `DIM_FC`;
  - `RESULTADO_PLANO3 = { metrica: 'ndcg', v2: 'S1', v1: 'S2', media, ic95: [a, b], nUsuarios: 445, suportada: true }`, com os valores copiados de `resultados/avaliacao-v2.json` → `comparacaoPrincipal`.
- Produz `app/package.json`:
  - `"type": "module"`, `"engines": { "node": ">=22 <23" }`;
  - scripts `test`, `test:integracao`, `test:web` e `e2e`, conforme a seção "Ambiente".

- [ ] **Passo 1: criar a tag local da pesquisa.** Rodar `git tag pesquisa-plano3-final 6077974fb015c31c870eb5c4995a3a6f45682ca7`. Sem push.
- [ ] **Passo 2: escrever os testes que falham.** Em `app/testes/congelamento.test.js`:
  - `congelamento: código da pesquisa idêntico a c048537`: `git -C <raiz> diff --exit-code <COMMIT_CODIGO> -- :/src :/scripts :/package.json :/package-lock.json` sai com 0, comparando a árvore de trabalho com o commit;
  - `congelamento: resultados idênticos a 6077974`: `git diff --exit-code <COMMIT_PESQUISA> -- :/resultados :/docker-compose.yml :/.env.example` sai com 0;
  - `integridade: HASHES iguais aos de 6077974`: `JSON.parse(git show <COMMIT_PESQUISA>:resultados/configuracao-v2.json).hashes` tem `regua`, `treino` e `vetoresFC` iguais a `HASHES`;
  - `integridade: RESULTADO_PLANO3 igual a 6077974`: cada campo de `RESULTADO_PLANO3` (menos `v1`/`v2`, conferidos contra `v1`/`v2` do JSON) é igual ao de `git show …:resultados/avaliacao-v2.json` → `comparacaoPrincipal`;
  - `congelamento: rodar de dentro de app/ não muda o resultado`: o mesmo diff executado com `cwd = app/` também sai com 0, e um caminho inexistente (`:/src-inexistente`) é rejeitado.

  Em `app/testes/isolamento.test.js`, as regras da §10.1, usando `es-module-lexer` para coletar `import`, `export … from` e `import()`, e uma busca textual de `require(` e `createRequire`:
  - `isolamento: sem import() dinâmico não literal`;
  - `isolamento: sem createRequire`;
  - `isolamento: imports da raiz só os permitidos`, com a lista permitida por pasta (`app/servidor/`, `app/preparar/`, `app/testes/referencia/`, `app/testes/determinismo/`) exatamente como na §10.1 e na §10.3;
  - `isolamento: strings proibidas ausentes no código de produção`: `incluirTeste`, `u1.test`, `u.data`, `.test'`, `ua.` e `ub.` não aparecem em `app/servidor/`, `app/preparar/`, `app/comum/` nem em `app/web/src/` (exceto `*.test.jsx`);
  - `isolamento: nos testes, nomes proibidos só no fixture declarado`: em `app/testes/` e nos `*.test.jsx`, `incluirTeste` não aparece em lugar nenhum. Os nomes de arquivos proibidos (`u1.test`, `u.data`, `u2.test`…`u5.test`, `ua.test`, `ub.test`) só podem aparecer em `app/testes/fixtures/nomes-proibidos.js`, que exporta `NOMES_PROIBIDOS: string[]` para os testes que montam zips **sintéticos**. A regra de imports proibidos vale para os testes como para a produção, com as exceções nomeadas da §10.3;
  - `isolamento: o fixture não lê arquivos`: `nomes-proibidos.js` não importa nada e só exporta a lista;
  - `isolamento: recomendacao não importa midia`.
- [ ] **Passo 3: rodar e ver falhar.** Rodar `cd app && npm test`. O esperado é falhar porque `integridade.js` não existe.
- [ ] **Passo 4: implementar** `app/package.json` (com a dependência `es-module-lexer`), `app/integridade.js`, o `.dockerignore` e o `.gitignore`. Rodar `npm install` em `app/` para gerar o lockfile.
- [ ] **Passo 5: rodar e ver passar.** Rodar `cd app && npm test`. O esperado é PASS.
- [ ] **Passo 6: commit** com a mensagem `feat(app): esqueleto, constantes de integridade e travas de congelamento e isolamento`. Depois, `git status --porcelain` tem de sair vazio (critério (b)).

---

### Tarefa 2: Utilitários de catálogo (títulos, gêmeos, estado, erros do Postgres)

**Arquivos:**
- Criar: `app/comum/titulos.js`, `app/comum/gemeos.js`, `app/comum/estado.js`, `app/comum/erros-pg.js` e `app/preparar/gemeos-manuais.json`.
- Testes: `app/testes/unidade/titulos.test.js`, `gemeos.test.js`, `estado.test.js` e `erros-pg.test.js`.

**Interfaces:**
- **`titulos.js`:**
  - `tituloExibicao(tituloOriginal: string) → string`: tira o sufixo ` (AAAA)` e move o artigo final (`The`, `A`, `An`, `La`, `Le`, `Les`, `Il`, `Das`, `Der`, `Die`, `El`, `L'`) para o início, inclusive quando há um alias entre parênteses, como em `"City of Lost Children, The (1995)"` → `"The City of Lost Children"`;
  - `tituloBusca(tituloOriginal: string) → string`: minúsculas, sem acentos (NFD sem diacríticos), sem pontuação, contendo a forma original **e** a de exibição separadas por espaço, para que "usual suspects" e "the usual suspects" casem.
- **`gemeos.js`:**
  - `detectarGemeos(filmes: Array<{id, titulo}>) → Array<{ menor, maior, evidencia: 'titulo_identico' }>`;
  - `carregarGemeosManuais() → Array<{ menor: 1202, maior: 1504, evidencia: 'mesmo_imdb_poc_2026-11-15' }>`;
  - `calcularOcultos(pares) → Set<number>` = {267} ∪ {cada `maior`}.
- **`estado.js`:**
  - `gravarEstado(dir, estado)` e `lerEstado(dir) → estado | null`, com gravação atômica (arquivo temporário + `rename`);
  - `garantirCredenciais(dir) → { app_leitura, app_escrita }`, que cria com `crypto.randomBytes(24).toString('base64url')` e modo `0o600` só quando o arquivo não existe;
  - `lerCredenciais(dir) → {…} | null`.
- **`erros-pg.js`:** `classificarErroPg(erro) → 'disponibilidade' | 'integridade' | 'credenciais' | 'outro'`, com os códigos e mensagens da spec §4.3:
  - `ECONNREFUSED`, `ENOTFOUND`, `57P01`, `57P03` e "Connection terminated" → disponibilidade;
  - `28P01` → credenciais;
  - `42501`, `42P01` e as mensagens de `buscarColaborativos` que começam com "régua do banco difere", "treino do banco difere" ou "banco sem filmes_fc" → integridade.

- [ ] **Passo 1: escrever os testes que falham:**
  - `tituloExibicao` com os casos `"Usual Suspects, The (1995)"` → `"The Usual Suspects"`, `"Toy Story (1995)"` → `"Toy Story"` e `"City of Lost Children, The (1995)"` → `"The City of Lost Children"`, mais um título sem ano e o id 267 (`"unknown"`);
  - `tituloBusca` com `"Cité des enfants perdus, La (1995)"`, que contém `"cite des enfants perdus"` (foco de revisão 1);
  - `detectarGemeos` sobre uma lista sintética com 2 pares e 1 título único → 2 pares com `menor < maior`;
  - **teste dependente de dados**, em `app/testes/referencia/gemeos-dados.test.js` (pasta de exceção, §10.3) e ignorado sem `ML100K_DIR`: sobre `criarContexto({ fase: 'v2-final', dirDados }).dataset.filmes`, `detectarGemeos` devolve **exatamente 18** pares, e os títulos de 1202 e 1504 contêm `"Bewegte Mann, Der"` e `1994`;
  - `calcularOcultos` contém 267, os 18 maiores e 1504, e não contém 1202;
  - `garantirCredenciais` é idempotente (segunda chamada devolve as mesmas senhas), com modo `0o600` no POSIX e o teste ignorado no Windows;
  - `gravarEstado` não deixa arquivo temporário e não grava o campo `senha`;
  - `classificarErroPg`: um caso por código.
- [ ] **Passo 2:** rodar `npm test` e ver FAIL.
- [ ] **Passo 3: implementar** os quatro módulos e o JSON manual.
- [ ] **Passo 4:** rodar `npm test` e ver PASS.
- [ ] **Passo 5: commit** com a mensagem `feat(app): títulos, gêmeos, estado e classificação de erros`.

---

### Tarefa 3: Compose de desenvolvimento, migração do schema `app` e papéis

**Arquivos:**
- Criar: `app/compose.yml` (só o serviço `db` por enquanto, completo conforme a §4.1, com `name: recomendacao-app`), `app/compose.dev.yml` e `app/banco/migracoes/001_inicial.sql`.
- Criar: `app/preparar/papeis.js` e `app/testes/integracao/apoio.js`.
- Testes: `app/testes/integracao/papeis.test.js`.

**Interfaces:**
- `001_inicial.sql`: todas as tabelas da §5.1 com `CREATE … IF NOT EXISTS`, `CREATE EXTENSION IF NOT EXISTS pgcrypto` (para `gen_random_uuid`) e `app.migracao`.
- `aplicarMigracoes(client) → number[]`: as versões aplicadas, em `app/preparar/papeis.js`.
- `aplicarPapeis(client, { senhas, superusuario })`, conforme a §4.2, passo 5, e a §5.2:
  - `CREATE ROLE … LOGIN` se não existir, e `ALTER ROLE … PASSWORD` com o literal montado por **`pg.escapeLiteral`**, a função exportada pelo módulo `pg` (`import pg from 'pg'`). Ela foi conferida em `pg` 8.23.1, e `app/package.json` exige `"pg": "^8.23.1"`. O comando roda depois de `SET LOCAL log_statement = 'none'` e `SET LOCAL log_min_error_statement = 'panic'`;
  - os GRANTs da §5.2 e `ALTER DEFAULT PRIVILEGES FOR ROLE <superusuario> IN SCHEMA v2_final GRANT SELECT ON TABLES TO app_leitura` (e o mesmo em `app`);
  - os nomes dos papéis são as constantes `'app_leitura'` e `'app_escrita'`.
- `apoio.js`:
  - `configSuperusuario()`;
  - `garantirBancoTeste() → configPg`, que cria `app_teste` se faltar;
  - `copiarArquivosML(destino)`, que copia só os 5 arquivos de `ML100K_DIR` depois de conferir o sha256 contra `SHA256_ARQUIVOS`;
  - `poolComo(papel, senha)`.

- [ ] **Passo 1: escrever os testes que falham** em `papeis.test.js`, num `v2_final` mínimo criado pelo próprio teste (`CREATE SCHEMA v2_final; CREATE TABLE v2_final.filmes_fc(id int)`):
  - `migracoes idempotentes`: aplicar duas vezes não dá erro, e `app.migracao` tem `[1]`;
  - `app_escrita não escreve em v2_final`: o INSERT dá erro `42501`;
  - `app_leitura não escreve em app`;
  - `app_leitura: current_schema() = v2_final com search_path=v2_final,public`;
  - `GRANT sobrevive a DROP/CREATE`: depois de `DROP TABLE v2_final.filmes_fc; CREATE TABLE v2_final.filmes_fc(id int)` como superusuário, `app_leitura` ainda faz `SELECT`;
  - `senha com caracteres especiais funciona`: com a senha `` a'b\c"d$1 ;--é `x` ``, `aplicarPapeis` cria o papel, e um `poolComo('app_leitura', senha)` conecta e faz `SELECT 1`. Rodar de novo com outra senha especial faz a antiga ser recusada (`28P01`) e a nova aceita;
  - `pg.escapeLiteral existe`: `typeof pg.escapeLiteral === 'function'`;
  - `senha não vai ao log`: `ALTER ROLE` com as duas senhas especiais acima, mais uma execução forçada a falhar (papel inexistente num `ALTER ROLE` direto, dentro do mesmo esquema de `SET LOCAL`), e depois `docker compose logs db` sem nenhuma das senhas. Esse caso é ignorado se `docker` não estiver disponível; o CI da Tarefa 16 o roda.
- [ ] **Passo 2:** subir o banco de desenvolvimento e rodar `npm run test:integracao -- testes/integracao/papeis.test.js`. Esperado: FAIL.
- [ ] **Passo 3: implementar** a migração, `aplicarMigracoes`, `aplicarPapeis` e `apoio.js`.
- [ ] **Passo 4:** rodar e ver PASS. Rodar também `npm test`, que deve continuar PASS.
- [ ] **Passo 5: commit** com a mensagem `feat(app): schema app, papéis e compose de desenvolvimento`.

---

### Tarefa 4: Obtenção dos dados do MovieLens

**Arquivos:**
- Criar: `app/preparar/dados.js` e `app/compose.local-zip.yml`.
- Testes: `app/testes/unidade/dados.test.js`.

**Interfaces:**
- `obterArquivosML({ destino, zipLocal?, baixar = fetchComTentativas, log }) → { origem: 'existente'|'zip-local'|'download', md5Zip?: string }`:
  - se `destino/ml-100k` já tiver os 5 arquivos com o sha256 certo, devolve `existente` sem tocar na rede;
  - senão, usa o `zipLocal` ou baixa a URL da §4.2, passo 2;
  - extrai **só** os 5 nomes (`ml-100k/<nome>`) num diretório temporário irmão, confere o sha256 de cada um e troca o diretório por `rename`.
- `fetchComTentativas(url) → Buffer`: 3 tentativas com `AbortSignal.timeout(60_000)`.
- Erros como `ErroPreparacao { causa: string, comando: string }`, exportado de `dados.js`:
  - sem rede: causa "Não consegui baixar o MovieLens 100K (sem internet ou servidor fora do ar).", comando `docker compose -f compose.yml -f compose.local-zip.yml run --rm preparar`;
  - sha256 divergente: causa "O arquivo <nome> baixado não confere com o usado na pesquisa." e o mesmo comando.

- [ ] **Passo 1: escrever os testes que falham.** Os zips sintéticos são montados com `adm-zip` no próprio teste, com conteúdo inventado, e um `baixar` falso é injetado. Os nomes proibidos vêm **só** de `NOMES_PROIBIDOS`, de `app/testes/fixtures/nomes-proibidos.js` (Tarefa 1):
  - `extrai só os 5 arquivos`: um zip com todos os `NOMES_PROIBIDOS` sob `ml-100k/` resulta numa pasta **sem** nenhum deles. O teste usa os sha256 de um conjunto sintético por injeção `{ sha256Esperado }`, um parâmetro opcional só para teste;
  - `sha256 divergente → ErroPreparacao` e a pasta final não existe;
  - `sem rede → ErroPreparacao com causa em português e o comando do zip local` (foco de revisão 5);
  - `existente → não chama baixar`;
  - `zip reempacotado (MD5 diferente) com os mesmos arquivos é aceito`.
- [ ] **Passo 2:** rodar `npm test` e ver FAIL.
- [ ] **Passo 3: implementar** `dados.js` e o `compose.local-zip.yml`, que monta `${ML100K_ZIP}` em `/var/app/zip/ml-100k.zip:ro` e define `ML100K_ZIP=/var/app/zip/ml-100k.zip` no `preparar`.
- [ ] **Passo 4:** rodar `npm test` e ver PASS.
- [ ] **Passo 5: commit** com a mensagem `feat(app): obtenção dos 5 arquivos do ML-100K com sha256 por arquivo`.

---

### Tarefa 5: `fc` reconstruído do banco e conferência dos vetores

**Arquivos:**
- Criar: `app/comum/fc-banco.js` e `app/preparar/script16.js`.
- Testes: `app/testes/integracao/fc-banco.test.js`.

**Interfaces:**
- `rodarScript16({ pg, dirDados, dirTrabalho }) → Promise<void>`:
  - executa `process.execPath` com `scripts/16-carregar-v2.js --fase v2-final` (caminho resolvido a partir da raiz do repositório), `cwd: dirTrabalho` e o `env` **explícito** `{ PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, DIR_DADOS: <dirDados>/ml-100k, PATH }`;
  - rejeita com a última linha do stderr.
- `carregarFcDoBanco(executor) → { fc: { nUsuarios, fasPorFilme: Map }, linhas: number, dim: number, valores: Map<id, Float32Array> }`: lê `id, embedding::real[] AS v, vector_dims(embedding) AS d` de `v2_final.filmes_fc` numa única consulta.
- `conferirVetores({ fc, linhas, dim, valores }) → { ok: true } | { ok: false, causa: string }`:
  - `linhas === N_FC`, `dim === DIM_FC` e `hashVetoresFC(fc) === HASHES.vetoresFC`;
  - em cada posição não nula, `|v − Math.fround(1/Math.sqrt(|fãs|))| ≤ 1e-7`;
  - as causas são "vetores: contagem", "vetores: suporte (hash)" e "valores dos vetores".
- `impressaoDigital(executor, { comConteudo: boolean }) → { oids: [n, n, n], nFc, hashRegua, hashTreino, concluidaEm, md5Conteudo?: string }`, com a consulta da §4.3 (vigia).

- [ ] **Passo 1: escrever os testes que falham.** Usam `garantirBancoTeste()` e `copiarArquivosML`, e rodam `rodarScript16` uma vez no `before` do arquivo:
  - `script 16 grava os hashes congelados`: `v2_final.metadados` tem `HASHES.regua` e `HASHES.treino`;
  - `script 16 não escreve na árvore`: o retrato de `git status --porcelain` da raiz tirado antes é igual ao tirado depois (critério (a)), e `artefatos/regua-v2-final.json` aparece em `dirTrabalho`;
  - `fc reconstruído confere`: `conferirVetores(await carregarFcDoBanco(pool)).ok === true`;
  - `valor adulterado é detectado`: depois de um `UPDATE` de um componente não nulo de um vetor (via `v[1] = …`) numa transação revertida no fim do teste, a causa é `"valores dos vetores"`;
  - `impressaoDigital muda com DROP/CREATE`: os OIDs são diferentes depois de rodar o script 16 de novo.
- [ ] **Passo 2:** rodar e ver FAIL.
- [ ] **Passo 3: implementar.**
- [ ] **Passo 4:** rodar e ver PASS.
- [ ] **Passo 5: commit** com a mensagem `feat(app): reconstrução e conferência do fc a partir do banco`.

---

### Tarefa 6: Tabelas de referência (filmes, estatísticas, gêmeos)

**Arquivos:**
- Criar: `app/preparar/referencia.js`.
- Testes: `app/testes/integracao/referencia.test.js`.

**Interfaces:**
- `preencherReferencia(client, ctx) → { nFilmes, nFc, nGemeos }`:
  - recebe `ctx` de `criarContexto({ fase: 'v2-final', dirDados })`, com o objeto literal (§4.2, passo 6), e faz `assert(ctx.alvos === null)`;
  - grava `app.filme` com `titulo_original`, `titulo_exibicao`, `titulo_busca` e `generos` (os nomes em inglês de `ctx.dataset.generos`, exceto "unknown"), `tem_vetor` vindo de `v2_final.filmes_fc` e `visivel = !OCULTOS.has(id)`;
  - grava `app.estatistica_historica` a partir de `ctx.regua.contagens` e de somas sobre `ctx.treino`;
  - grava `app.filme_gemeo` nos dois sentidos;
  - faz as conferências da §4.2, passo 6, e lança erro se alguma falhar;
  - **é idempotente sem apagar nada que os usuários usam.** É proibido `TRUNCATE` (com ou sem `CASCADE`) e `DELETE` em `app.filme`, `app.estatistica_historica`, `app.perfil` e `app.interacao`. Assim:
    - `app.filme` e `app.estatistica_historica` são gravadas por `INSERT … ON CONFLICT (id) DO UPDATE SET <todas as colunas>`. O conjunto de ids é sempre 1..1682, e um id em `app.filme` fora de `ctx.dataset.filmes` faz a função lançar erro sem alterar nada;
    - `app.filme_gemeo`, que nenhuma tabela de usuário referencia, é reescrita por `DELETE FROM app.filme_gemeo` seguido de `INSERT`;
    - tudo roda na transação dos passos 5 a 7 (§4.2), e as tabelas `app.perfil` e `app.interacao` nunca aparecem no SQL deste módulo.

- [ ] **Passo 1: escrever os testes que falham:**
  - `1682 filmes e 1682 estatísticas`;
  - `SUM(n_notas) = ctx.treino.length`;
  - `ordem de populares = rankingPopularidade(regua.contagens)`, comparando as listas inteiras;
  - `filmes de 0 notas estão presentes`;
  - `tem_vetor em exatamente 1385`;
  - `visivel = false exatamente em OCULTOS` (são 20: o 267, os 18 maiores e o 1504);
  - `gêmeos simétricos (38 linhas)`;
  - `idempotente`: rodar duas vezes dá as mesmas linhas;
  - `não toca dados de usuários`: inserir por SQL um perfil e 5 interações (incluindo uma nota num filme e um "gostei"), rodar `preencherReferencia` de novo e conferir que `app.perfil` e `app.interacao` ficam **idênticas** (comparação linha a linha, incluindo `atualizado_em`);
  - `sem TRUNCATE nem DELETE proibido`: um teste estático lê `app/preparar/referencia.js` e confere que não contém `TRUNCATE` nem `DELETE FROM app.(filme|estatistica_historica|perfil|interacao)`.
- [ ] **Passo 2:** rodar e ver FAIL.
- [ ] **Passo 3: implementar.**
- [ ] **Passo 4:** rodar e ver PASS.
- [ ] **Passo 5: commit** com a mensagem `feat(app): tabelas de referência com conferências contra a régua`.

---

### Tarefa 7: Orquestração da preparação

**Arquivos:**
- Criar: `app/preparar/preparar.js` e `app/preparar/index.js`.
- Testes: `app/testes/integracao/preparar.test.js`.

**Interfaces:**
- `prepararTudo({ pg, dirDados, dirTrabalho, dirEstado, zipLocal?, versaoApp, porta, modoDev = false, log = console.log }) → Promise<'pronto'>`, que implementa os passos 0 a 8 da §4.2 na ordem da spec:
  - trava com `pg_try_advisory_lock(727101)`; se ela falhar, lança "outra preparação em andamento";
  - 30 tentativas de conexão com espera crescente (`min(500 ms · 2^i, 5 s)`);
  - recusa o banco da pesquisa (`PGPORT=5433` ou `PGDATABASE=recomendacao` sem `PREPARAR_ALVO_APP=1`; com `modoDev`, também recusa se existir `v2_final` sem `app`);
  - grava o estado a cada etapa, com `total: 8` e as mensagens em português;
  - escreve no fim `Pronto: abra http://localhost:<porta>`;
  - em caso de erro, grava `falhou` com a causa e o comando e lança de novo.
- `index.js` lê `PGHOST`…`PGDATABASE`, `APP_PORTA` (padrão 3000), `ML100K_ZIP`, `APP_MODO`, e `APP_DIR_DADOS`/`APP_DIR_TRABALHO`/`APP_DIR_ESTADO` (padrões `/var/app/{dados,trabalho,estado}`), e chama `prepararTudo`. Em caso de erro, sai com código 1.

- [ ] **Passo 1: escrever os testes que falham** (num banco `app_teste_prep` próprio, recriado no `before`):
  - `primeira preparação termina pronta`: `estado.json` com `estado: 'pronto'`, o selo `app.preparacao` com os três hashes, e `credenciais.json` existente;
  - `segunda preparação pula download e script 16`: com um `baixar` injetado que lança erro, ela ainda termina `pronto`, e os OIDs de `v2_final` não mudam;
  - `estado.json nunca contém senhas`: lê o arquivo e confere que não contém nenhum valor de `credenciais.json`;
  - `preparação interrompida não passa como pronta`: depois de forçar uma exceção logo antes do selo (por um gancho injetado `antesDoSelo`), o selo está ausente, o estado é `falhou`, e a preparação seguinte refaz até o selo;
  - `duas preparações simultâneas`: a segunda lança "outra preparação em andamento";
  - `recusa o banco da pesquisa`: com `pg.port = 5433` lança o erro de recusa sem conectar;
  - `linha Pronto usa a porta`: com `porta: 3317`, o log contém `http://localhost:3317`;
  - **`nova preparação preserva os dados dos usuários` (obrigatório):**
    1. preparar;
    2. criar por SQL 2 perfis com notas, "gostei" e "quero assistir";
    3. guardar um retrato de `app.perfil` e `app.interacao` e das estatísticas locais (`COUNT`/`AVG` por filme das notas que não são de perfis de exemplo);
    4. apagar o selo `app.preparacao`, para forçar o passo 6 a rodar de novo, e rodar `prepararTudo`;
    5. conferir que os retratos são idênticos.

    O mesmo vale depois de forçar o **script 16** de novo (o selo é apagado e os hashes de `v2_final.metadados` são invalidados antes da preparação).
- [ ] **Passo 2:** rodar e ver FAIL.
- [ ] **Passo 3: implementar.**
- [ ] **Passo 4:** rodar e ver PASS, e `npm test` também PASS.
- [ ] **Passo 5: commit** com a mensagem `feat(app): preparação idempotente com selo, trava e estado`.

---

### Tarefa 8: Núcleo da S1 (pipeline, efeitos, explicações) e equivalência com a referência

**Arquivos:**
- Criar: `app/servidor/recomendacao/s1.js` e `app/servidor/recomendacao/explicacao.js`.
- Testes: `app/testes/unidade/s1.test.js`, `app/testes/unidade/explicacao.test.js`, `app/testes/referencia/equivalencia.test.js` (camada (a)) e `app/testes/integracao/precisao.test.js` (camada (b)).

**Interfaces:**
- **`s1.js`:**
  - `export const M = 300, N_FC = 150, K = 10, MODO = 'hnsw'`;
  - `contribui({ tipo, nota }, temVetor) → boolean` = `temVetor && (tipo === 'gostei' || (tipo === 'nota' && nota >= 4))`;
  - `calcularEfeitos({ nova, anterior, temVetor }) → { contribuiParaPerfil, excluidoDasRecomendacoes, perfilMudou }`, conforme a §6.2; `nova = null` representa o DELETE;
  - `derivarConjuntos(interacoes: Array<{ filmeId, tipo, nota }>, fc, ocultos: Set) → { curtidos: number[], curtidosComVetor: number[], excluir: Set<number> }`;
  - `async recomendar({ interacoes, fc, ocultos, rankingPopulares: number[], buscar }) → { motivo, itens: Array<{ id, fonte: 'S1'|'populares', escore: number|null, porque: number[] }>, perfil: { curtidos, curtidosComVetor }, busca: { m: 300, nFc: 150, linhasPedidas, empateNaoResolvido, candidatosS1, nExcluidos } }`, que segue os passos 1 a 9 da §4.4;
  - `buscar(vetor, excluirOrdenado: number[], m, modo) → Promise<{ lista: Array<{ id, escore }>, linhasPedidas, empateNaoResolvido }>`;
  - `criarBuscarBanco(poolLeitura) → buscar`, que chama `buscarColaborativos(pool, { vetor, excluir, m, hashes: { regua: HASHES.regua, treino: HASHES.treino }, modo })`.
- **`explicacao.js`:** `explicar(fc, curtidosComVetor: number[], itemId) → number[]` (no máximo 2), com a regra de inteiros da §4.4, passo 9.

- [ ] **Passo 1: escrever os testes de unidade que falham**, com um `fc` sintético pequeno e `buscar` falso:
  - `efeitos`: "gostei" → nota 2 dá `perfilMudou: true` e `contribuiParaPerfil: false`; um DELETE de "gostei" dá `perfilMudou: true`; nota 3 sobre nada dá `perfilMudou: false`; e `contribuiParaPerfil` equivale a pertencer a `curtidos` e ter vetor, conferido por propriedade sobre todas as combinações;
  - `excluir contém interagidos e ocultos`;
  - **os cinco motivos:**
    - `sem_curtidas` quando não há curtida;
    - `curtidas_sem_vetor` quando só há curtida sem vetor;
    - `sem_semelhantes` quando `buscar` devolve `[]` com perfil;
    - `parcial` quando `buscar` devolve 4 itens;
    - `personalizado` quando devolve 300;
  - `S1 = prefixo de 10 dos 150 primeiros de H`: com 300 itens, os 10 itens com `fonte: 'S1'` são os 10 primeiros;
  - `buscar recebe m=300 e modo hnsw`;
  - `preenchimento pula excluir e itens já na lista`;
  - `populares sem porque` e `todo item S1 tem 1 ou 2 porque`.

  Em `explicacao.test.js`:
  - `exclui contribuição zero`;
  - `ordem normalizada difere da interseção crua`, com o caso numérico da revisão: i₁ com |F| = 400 e interseção 40, i₂ com |F| = 25 e interseção 15, e i₂ vem primeiro;
  - `desempate por menor id`.
- [ ] **Passo 2: escrever o teste de equivalência, camada (a)**, em `app/testes/referencia/equivalencia.test.js`, ignorado sem `ML100K_DIR`:
  - monta `ctx = criarContexto({ fase: 'v2-final', dirDados })`, `fc = construirFC(ctx.treino, 943)` e `OCULTOS` (a partir de `detectarGemeos` e do manual), com 30 perfis sintéticos, semente 2026 e 0 a 15 curtidos, incluindo os casos da §10.5 (a);
  - `buscar` é injetado como `rankingReferencia(fc, perfilFC(fc, curtidos), new Set(excluir), M)`;
  - a referência independente, escrita no teste, é `rankingReferencia(…, 300).slice(0, 150).slice(0, 10)` mais o preenchimento por `rankingPopularidade(ctx.regua.contagens)` sem `excluir`;
  - exige ids, escores, `fonte` e `motivo` idênticos (`deepStrictEqual`);
  - também confere que o `fc` de `construirFC` dá `hashVetoresFC === HASHES.vetoresFC`.
- [ ] **Passo 3: escrever o teste de precisão, camada (b)**, em `app/testes/integracao/precisao.test.js`, com o banco preparado:
  - os mesmos 30 perfis, `buscar` real em `modo: 'exata'` (parâmetro de teste) e `conferirExataUsuario` de `src/avaliacao/fidelidade.js` com `m = 300`;
  - exige `ok === true` em todos e registra no `t.diagnostic` o total de `divergenciasPrecisao`;
  - confere `|escore − escoreOficial(escore64)| ≤ 1e-6 + 1e-12` para os itens comuns;
  - **invariantes HNSW**, com o mesmo perfil e o `modo` padrão: no máximo 10 itens, nenhum em `excluir`, escores S1 decrescentes e > 0.
- [ ] **Passo 4:** rodar os três e ver FAIL.
- [ ] **Passo 5: implementar** `s1.js` e `explicacao.js`.
- [ ] **Passo 6:** rodar `npm test`, `node --test testes/referencia/equivalencia.test.js` e `npm run test:integracao -- testes/integracao/precisao.test.js`, e ver PASS. Anotar no relatório o número de divergências de precisão.
- [ ] **Passo 7: commit** com a mensagem `feat(app): pipeline da S1 com efeitos, explicações e equivalência com a referência`.

---

### Tarefa 9: Servidor: segurança, pools, ciclo de estados e vigia

**Arquivos:**
- Criar: `app/servidor/app.js`, `app/servidor/seguranca.js`, `app/servidor/pools.js`, `app/servidor/ciclo.js`, `app/servidor/index.js`, `app/servidor/rotas/saude.js` e `app/servidor/rotas/sobre.js`.
- Testes: `app/testes/unidade/seguranca.test.js`, `app/testes/unidade/ciclo.test.js` e `app/testes/integracao/ciclo.test.js`.

**Interfaces:**
- `construirApp({ ciclo, porta, dirWeb?: string }) → FastifyInstance`, que:
  - registra a segurança, as rotas (das Tarefas 9 a 12) e o `@fastify/static` de `dirWeb`, com fallback para `index.html` fora de `/api`;
  - responde `404 ROTA_NAO_ENCONTRADA` em `/api/*` desconhecida.
- `registrarSeguranca(app, { porta })`:
  - os hooks de `Host`/`Origin`/`Sec-Fetch-Site`/`Content-Type` da §6.1;
  - `app.removeContentTypeParser('text/plain')`;
  - `bodyLimit` de 4096;
  - o helmet com a configuração **exata** da §7: `useDefaults: false`, as diretivas listadas e `hsts: false`;
  - o formato de erro `{ codigo, mensagem }`, com o catálogo da §6.1.
- `criarPools({ host, port, database, credenciais }) → { leitura, escrita }`:
  - `leitura` com `options: '-c search_path=v2_final,public'`, `escrita` sem;
  - `pool.on('error', …)` nos dois.
- `criarCiclo({ dirEstado, pg, intervalos = { vigiaSegundos: Number(env.APP_VIGIA_SEGUNDOS ?? 60), conteudoACada: Number(env.APP_VIGIA_CONTEUDO_A_CADA ?? 10) }, relogio = Date }) → Ciclo`, com:
  - `estado() → { estado: 'preparando'|'falhou'|'bloqueado'|'operante', etapa?, total?, mensagem?, causa?, comando? }`;
  - `async saude() → Saude`, que faz a reconferência limitada a 1 a cada 2 s quando o estado não é operante e devolve `perfis: { disponivel, motivo? }`;
  - `operante() → { pools, fc, ocultos: Set, rankingPopulares: number[], temVetor: Set } | null`;
  - `poolEscrita() → Pool | null`, para a gestão restrita;
  - `registrarErro(erro) → 'disponibilidade'|'integridade'|'credenciais'|'outro'`, que leva ao bloqueio quando o erro é de integridade ou de credenciais;
  - `iniciar()` e `parar()`.
- A conferência integral é `conferirIntegral(pools) → { ok, causa?, fc?, retrato? }`: hashes de `metadados` iguais a `HASHES`, `conferirVetores`, selo `app.preparacao` com os três hashes, e `current_schema()` do pool de leitura igual a `'v2_final'`. Também carrega `ocultos`, `temVetor` e `rankingPopulares` de `app.filme` e `app.estatistica_historica`.
- **Rotas:**
  - `GET /api/saude` responde **sempre 200** com o `Host` válido e é montada campo a campo;
  - `GET /api/sobre` traz a versão, `HASHES`, `COMMIT_CODIGO`, `RESULTADO_PLANO3`, os textos de licença e a citação (Harper & Konstan, 2015) e os avisos de escopo da §7 (Sobre).

- [ ] **Passo 1: escrever os testes de unidade que falham**, com `app.inject` e um `ciclo` falso:
  - `Host evil.test → 421`;
  - `Host localhost:3317 com porta 3317 → 200`, `localhost:3000 com porta 3317 → 421`, `[::1]:3317 → 200`, e sem porta só aceito com `porta = 80`;
  - `POST com Origin http://evil.test → 403`;
  - `Sec-Fetch-Site cross-site → 403`;
  - `POST text/plain → 415`;
  - `corpo de 5 KB → 413 CORPO_GRANDE`;
  - `cabeçalho CSP exato e sem Strict-Transport-Security`;
  - `saude nunca repassa campos desconhecidos`: um estado falso com `senha: 'x'` não aparece na resposta.

  Em `ciclo.test.js` (unidade, com o relógio e o estado falsos):
  - `preparando → operante quando estado.json vira pronto e a conferência passa`;
  - `reconferência limitada a 1 por 2 s`;
  - `erro de disponibilidade não bloqueia`;
  - `erro de integridade bloqueia`;
  - `28P01 bloqueia com causa credenciais`;
  - `padrões da vigia são 60 s e 10 ciclos` (§10.6 d).
- [ ] **Passo 2: escrever os testes de integração que falham**, em `app/testes/integracao/ciclo.test.js`, com o banco preparado e o servidor real criado com `construirApp` e `criarCiclo` (`vigiaSegundos: 1`, `conteudoACada: 1`). Cada caso começa com o servidor **operante**:
  - (a) `UPDATE v2_final.metadados SET valor='x' WHERE chave='hash_treino'`: o próximo `GET /api/perfis/:id/recomendacoes` (rota registrada na Tarefa 12; até lá, chamar `ciclo.registrarErro` por meio de `criarBuscarBanco(...)`) leva ao estado `bloqueado` com causa contendo "treino";
  - (b) o `UPDATE` de um valor de vetor faz `/api/saude` mostrar `bloqueado` com "valores dos vetores" em até 10 s;
  - (c) `rodarScript16` de novo mantém o servidor `operante`, com o `fc` recarregado (o retrato muda);
  - depois de (a) e (b), restaurar os valores e chamar `/api/saude`, que deve voltar a `operante`;
  - `banco parado → BANCO_INDISPONIVEL e volta sozinho`, com `docker compose … stop db`/`start db`. Ignorado sem `docker`.
- [ ] **Passo 3:** rodar e ver FAIL.
- [ ] **Passo 4: implementar.**
- [ ] **Passo 5:** rodar e ver PASS.
- [ ] **Passo 6: commit** com a mensagem `feat(app): servidor com segurança, ciclo de estados e vigia de integridade`.

---

### Tarefa 10: Mídia local e catálogo de filmes

**Arquivos:**
- Criar: `app/servidor/midia/index.js`, `app/servidor/rotas/filmes.js` e `app/servidor/rotas/onboarding.js`.
- Testes: `app/testes/integracao/filmes.test.js` e `app/testes/unidade/midia.test.js`.

**Interfaces:**
- `criarFornecedorMidia(nome = process.env.MIDIA_FORNECEDOR ?? 'local') → { midia(filme) → Midia }`. Com `'local'`, devolve `{ cartaz: { tipo: 'gerado' }, sinopse: null, atribuicao: null }`. Qualquer outro nome lança `Error('MIDIA_FORNECEDOR desconhecido: <nome>')`.
- `cartaoFilme(linha, estadoPerfil, midia) → CartaoFilme`, conforme a §6.3, em `rotas/filmes.js` e reutilizado pelas outras rotas.
- **Rotas** (§6.2):
  - `GET /api/filmes`, com `q` (sobre `titulo_busca`, ignorando acentos e artigos), `genero`, `ordem` (`mais_bem_avaliados` usa a média bayesiana com C = 10 e m = a média global do treino, nunca exibida), `pagina`, `perfilId` e `soInfluenciam`;
  - `GET /api/filmes/:id`, que devolve `DetalheFilme` com as três fontes de estatística: `poucasNotas` com n < 5, e a fonte `computador` sem perfis `exemplo`;
  - `GET /api/generos`, com os 18 gêneros traduzidos e "Desconhecido";
  - `GET /api/perfis/:id/onboarding`, com a seleção curada da §6.2 e o cursor `n_notas:id`.
  - Todas respondem `503 PREPARANDO` ou `503 BLOQUEADO` fora do estado operante.

- [ ] **Passo 1: escrever os testes que falham:**
  - `midia: desconhecido lança`;
  - `filmes: q sem acento acha o título com acento` (foco de revisão 1);
  - `filmes: "shawshank" acha "Shawshank Redemption, The"`;
  - `filmes: ocultos ausentes`, que é o total = 1682 − 20;
  - `filmes/267 → 404 FILME_NAO_ENCONTRADO`, e o mesmo para `filmes/1504`;
  - `detalhe: computador com 4 notas → media null e poucasNotas`;
  - `detalhe: 5 notas → media`;
  - `detalhe: perfil exemplo não conta em computador`;
  - `detalhe: temGemeoOculto true para 246`;
  - `soInfluenciam devolve só temVetor`;
  - `onboarding: primeira página tem 2 por gênero real sem repetir, todos com vetor e visíveis`;
  - `onboarding: interagidos continuam com estadoPerfil`;
  - `onboarding: cursor sem duplicar nem pular`;
  - `onboarding: q filtra`;
  - `503 PREPARANDO fora do operante`.
- [ ] **Passo 2:** rodar e ver FAIL.
- [ ] **Passo 3: implementar.**
- [ ] **Passo 4:** rodar e ver PASS.
- [ ] **Passo 5: commit** com a mensagem `feat(app): catálogo, detalhe com estatísticas separadas, onboarding curado e mídia local`.

---

### Tarefa 11: Perfis e interações

**Arquivos:**
- Criar: `app/servidor/rotas/perfis.js`, `app/servidor/rotas/interacoes.js` e `app/servidor/exemplo.json`.
- Testes: `app/testes/integracao/perfis.test.js`.

**Interfaces:**
- **Rotas** (§6.2):
  - `GET/POST/PATCH/DELETE /api/perfis`: `nome` com `btrim`, de 1 a 40 caracteres; no máximo 20 perfis, com `pg_advisory_xact_lock(727102)`; `contagens`, incluindo `curtidos` e `curtidosComVetor`;
  - `POST /api/perfis/exemplo`: idempotente, por `exemplo = true`, com os 6 ids de `exemplo.json`, que quem constrói escolhe pelas regras da §6.2;
  - `PUT` e `DELETE /api/perfis/:id/interacoes/:filmeId`, com upsert por `ON CONFLICT … DO UPDATE SET tipo, nota, atualizado_em = now()`, `anterior` e `efeitos` vindos de `calcularEfeitos`;
  - `GET /api/perfis/:id/interacoes?tipos=nota,gostei&pagina=`.
- **Fora do estado operante,** só `GET /api/perfis` e `DELETE /api/perfis/:id` funcionam, pelo `ciclo.poolEscrita()`. As outras respondem 503. Sem pool de escrita, a resposta é `503 BANCO_INDISPONIVEL`.

- [ ] **Passo 1: escrever os testes que falham:**
  - `nome só com espaços → 400`, `41 caracteres → 400` e `emoji dentro de 40 → 201` (foco de revisão 2);
  - `21º perfil → 409 LIMITE_PERFIS, também com 5 POSTs concorrentes partindo de 18`;
  - `exemplo idempotente e com 6 gostei, todos com vetor e visíveis`;
  - `PUT gostei → nota 2 devolve anterior gostei e perfilMudou true`;
  - `DELETE devolve anterior e excluidoDasRecomendacoes false`;
  - `PUT em 267 → 404`;
  - `perfil inexistente → 404 PERFIL_NAO_ENCONTRADO`;
  - `DELETE perfil cascata`;
  - `contagens.curtidosComVetor`;
  - `tipos=nota,gostei filtra`;
  - **modo bloqueado** (com o ciclo forçado a `bloqueado` pelo `UPDATE` de hash da Tarefa 9): `GET /perfis → 200`, `DELETE /perfis/:id → 200` e apaga as interações, `PUT interação → 503 BLOQUEADO`;
  - **credenciais adulteradas**: `/saude.perfis = { disponivel: false, motivo: 'credenciais' }`.
- [ ] **Passo 2:** rodar e ver FAIL.
- [ ] **Passo 3: implementar.**
- [ ] **Passo 4:** rodar e ver PASS.
- [ ] **Passo 5: commit** com a mensagem `feat(app): perfis, perfil de exemplo e interações com efeitos`.

---

### Tarefa 12: Recomendações, diagnóstico e auditoria do fecho de imports

**Arquivos:**
- Criar: `app/servidor/rotas/recomendacoes.js`, `app/servidor/rotas/diagnostico.js` e `app/testes/fecho.test.js`.
- Testes: `app/testes/integracao/recomendacoes.test.js`.

**Interfaces:**
- `GET /api/perfis/:id/recomendacoes`:
  - monta `Recomendacoes` (§6.3) a partir de `recomendar({ interacoes, fc, ocultos, rankingPopulares, buscar: criarBuscarBanco(pools.leitura) })`, com `porque` e `baseadoEm` (até 5) convertidos em `{ id, titulo }`;
  - **ignora a query string**;
  - um erro em `buscar` passa por `ciclo.registrarErro`: disponibilidade dá `503 BANCO_INDISPONIVEL`, integridade ou credenciais dão `503 BLOQUEADO`.
- `GET /api/diagnostico/busca?perfilId=` só é registrada quando `APP_DIAGNOSTICO === '1'`, e devolve `{ hnsw: ids, exata: ids, sobreposicao }`.
- `fecho.test.js`:
  - sobe `app/servidor/index.js` num processo filho com `--import` de um hook `module.register` que grava as URLs resolvidas, e encerra assim que o servidor estiver escutando (sem banco: estado `preparando`);
  - confere que nenhuma URL contém `src/contexto.js`, `src/dados/`, `src/avaliacao/`, `src/modelo/` ou `@tensorflow`;
  - faz o mesmo com `app/preparar/preparar.js` importado (sem executar), comparando com a lista exata permitida, que é o fecho do script 16 (17 arquivos de `src/`, conforme a §2 da revisão) mais `src/dados/download.js`. Esse caso só aplica a regra a `preparar`, porque o script 16 roda em subprocesso.

- [ ] **Passo 1: escrever os testes que falham:**
  - `perfil vazio → sem_curtidas com 10 populares sem porque`;
  - `3 gostei com vetor → 10 itens, motivo personalizado ou parcial, todo item S1 com porque`;
  - `curtida só em filme sem vetor → curtidas_sem_vetor`;
  - `nota 2 num item do top 10 → ele sai`;
  - `quero_assistir → sai e aparece em interacoes?tipos=quero_assistir`;
  - `?modo=exata&m=5 ignorados (busca.m = 300)`;
  - `ocultos nunca aparecem` (para 30 perfis aleatórios);
  - `diagnostico 404 sem APP_DIAGNOSTICO`;
  - `diagnostico 200 com APP_DIAGNOSTICO=1`;
  - `hash adulterado durante operante → 503 BLOQUEADO`.
- [ ] **Passo 2:** rodar e ver FAIL.
- [ ] **Passo 3: implementar.**
- [ ] **Passo 4:** rodar `npm test` e `npm run test:integracao` e ver PASS.
- [ ] **Passo 5: commit** com a mensagem `feat(app): rota de recomendações da S1, diagnóstico e auditoria do fecho`.

---

### Tarefa 13: Frontend: base, preparação, perfis e cartaz

**Arquivos:**
- Criar: `app/web/package.json` (com `react@18.3.1`, `react-dom@18.3.1`, `react-router-dom@6`, `vite@5`, `@vitejs/plugin-react@4`, `vitest@2`, `@testing-library/react@16`, `jsdom@25`), `app/web/vite.config.js` (com o proxy da §8: `changeOrigin: true` e o `Origin` reescrito para `http://localhost:3000`), `app/web/index.html` (`lang="pt-BR"`), `app/web/src/{main.jsx, App.jsx, api.js, estilos.css}`, `src/telas/{TelaPreparando, GestaoPerfisRestrita, TelaPerfis}.jsx` e `src/componentes/{Moldura, Cartaz, AvisoAcao}.jsx`.
- Testes: `app/web/src/**/*.test.jsx`.

**Interfaces:**
- **`api.js`:**
  - `chamar(metodo, caminho, corpo?) → Promise<json>`, com `cache: 'no-store'` e `Content-Type: application/json`, que lança `ErroApi { status, codigo, mensagem }`;
  - em `PERFIL_NAO_ENCONTRADO`, emite o evento `perfil-perdido`;
  - numa falha de rede, lança `ErroApi { codigo: 'SEM_SERVIDOR' }`.
- **`App.jsx`:**
  - faz polling de `/api/saude` a cada 2 s até `operante`;
  - fora do estado operante, renderiza a `TelaPreparando`;
  - guarda o perfil ativo no `localStorage` dentro de try/catch;
  - `perfil-perdido` limpa o perfil ativo e volta à `TelaPerfis`.
- **`Cartaz({ filme, midia, tamanho })`:**
  - SVG 2:3 determinístico, com o hash do id (FNV-1a de 32 bits) definindo o matiz dentro da família do primeiro gênero, um gradiente de 2 cores, um padrão e até 3 linhas de título;
  - contraste calculado (WCAG) ≥ 4,5, escolhendo texto claro ou escuro;
  - `role="img"` e `aria-label`;
  - o ramo `externo` usa `<img referrerpolicy="no-referrer" loading="lazy">` e cai no SVG no `onerror`.
- **`AvisoAcao`:** uma única região `aria-live="polite"` montada na `Moldura`, exposta por um contexto `useAviso()` com `mostrar({ texto, desfazer? })`, que dura 6 s.
- **Textos:** literais da spec §7 para `TelaPreparando`, `GestaoPerfisRestrita` e `TelaPerfis`.

- [ ] **Passo 1: escrever os testes que falham:**
  - `App: localStorage que lança não quebra e mostra TelaPerfis` (foco de revisão 3);
  - `App: perfil-perdido volta à TelaPerfis` (foco de revisão 4);
  - `TelaPreparando: mostra etapa 3 de 8`;
  - `TelaPreparando: bloqueado + perfis.disponivel mostra o link Apagar perfis e avaliações`;
  - `TelaPreparando: perfis indisponível mostra o texto com down -v`;
  - `GestaoPerfisRestrita: só excluir, sem criar`;
  - `TelaPerfis: aviso de perfil local e campo Apelido`;
  - `Cartaz: mesmo id → mesmo SVG; contraste ≥ 4,5 para 50 ids`;
  - `Cartaz: onerror cai no SVG`;
  - `AvisoAcao: Desfazer chama a função e some em 6 s`.
- [ ] **Passo 2:** rodar `npm run test:web` e ver FAIL.
- [ ] **Passo 3: implementar.** Sem CSS-in-JS em tempo de execução: os estilos ficam em `estilos.css`.
- [ ] **Passo 4:** rodar `npm run test:web` e ver PASS. Rodar `npm run build` em `app/web`, que deve passar.
- [ ] **Passo 5: commit** com a mensagem `feat(web): base, tela de preparação, gestão restrita, perfis e cartaz gerado`.

---

### Tarefa 14: Frontend: onboarding, catálogo, detalhe e controles de interação

**Arquivos:**
- Criar: `src/telas/{Onboarding, Catalogo, DetalheFilme}.jsx` e `src/componentes/{CartaoFilme, ControleRapido, ControleInteracao, PainelEstatisticas, BarraBusca}.jsx`.
- Testes: `*.test.jsx` correspondentes.

**Interfaces:**
- `ControleInteracao({ filme, estado, aoMudar })` e `ControleRapido(...)` chamam `PUT`/`DELETE` e repassam `{ anterior, efeitos }` ao `useAviso().mostrar`, com o texto escolhido por `fraseEfeitos({ efeitos, tipo, nota, temVetor, operacao })`, exportada de `ControleInteracao.jsx`, que devolve as frases **literais** da spec §7.
- As estrelas formam um `radiogroup` com rótulo "N de 5 estrelas", e clicar na estrela atual remove a nota.
- `PainelEstatisticas` mostra as três seções separadas, com os rótulos da §7.

- [ ] **Passo 1: escrever os testes que falham:**
  - `fraseEfeitos`: um caso para cada uma das 6 frases da §7;
  - `ControleInteracao: texto fixo literal`;
  - `estrelas: setas do teclado mudam a seleção e clicar na atual remove`;
  - `PainelEstatisticas: poucas notas em cinza e Neste computador recolhido abaixo de 5`;
  - `Onboarding: contador "N marcados · sugerimos pelo menos 3" e botão "Pular por enquanto" com 0`;
  - `Onboarding: nenhum texto afirma limiar` (o DOM não contém "Faltam" nem "para personalizar");
  - `Catalogo: busca vazia mostra o aviso de 1998`;
  - `CartaoFilme: selo "curtir não personaliza" quando não há vetor`.
- [ ] **Passo 2:** rodar e ver FAIL.
- [ ] **Passo 3: implementar.**
- [ ] **Passo 4:** rodar e ver PASS.
- [ ] **Passo 5: commit** com a mensagem `feat(web): onboarding, catálogo, detalhe e controles com efeitos`.

---

### Tarefa 15: Frontend: Top 10 com atualização automática, listas e Sobre

**Arquivos:**
- Criar: `src/telas/{Top10, MinhaLista, MinhasAvaliacoes, Sobre}.jsx` e `src/componentes/{ListaRecomendacoes, ExplicacaoMotivo}.jsx`.
- Testes: `*.test.jsx` correspondentes.

**Interfaces:**
- `useTop10(perfilId) → { lista, carregando, atualizando, erro, marcar(filmeId, acao) }`, que implementa a "Atualização automática do Top 10" da §7:
  - fila de escritas por filme e contador `seq`;
  - `AbortController` no `GET` anterior;
  - o "Novo" é calculado contra a lista da abertura da tela;
  - foco preservado;
  - em erro, a faixa "Não consegui atualizar as recomendações · Tentar de novo".
- A animação FLIP usa `getBoundingClientRect` e Web Animations, com no máximo 300 ms, e é desligada com `prefers-reduced-motion`.
- `ExplicacaoMotivo({ motivo })` usa os 5 textos literais da §7.
- `Sobre` mostra os números de `/api/sobre` → `RESULTADO_PLANO3`, em camadas, com os textos da §7.

- [ ] **Passo 1: escrever os testes que falham** (fetch simulado com atrasos controlados):
  - `resposta antiga que chega depois da nova é descartada`;
  - `duas marcações rápidas → um GET final, sem os dois itens`;
  - `foco vai para o item da mesma posição quando o focado sai`;
  - `Novo só para itens ausentes na abertura; Desfazer não gera Novo`;
  - `reduced-motion: troca sem animação`;
  - `erro no GET mostra a faixa Tentar de novo`;
  - `anúncio aria-live único com "Recomendações atualizadas"`;
  - `ExplicacaoMotivo: 5 textos literais`;
  - `Sobre: mostra a média e o IC de RESULTADO_PLANO3 e a frase "a lista se apoia em poucos filmes"`.
- [ ] **Passo 2:** rodar e ver FAIL.
- [ ] **Passo 3: implementar.**
- [ ] **Passo 4:** rodar e ver PASS, e `npm run build` também.
- [ ] **Passo 5: commit** com a mensagem `feat(web): top 10 com atualização automática, listas e Sobre`.

---

### Tarefa 16: Imagem Docker, Compose completo, ponta a ponta e CI

**Arquivos:**
- Criar: `app/Dockerfile` (§4.1), `app/testes/e2e/playwright.config.js`, `app/testes/e2e/fluxo.spec.js`, `app/testes/e2e/capturas.spec.js` e `.github/workflows/app.yml`.
- Criar: `app/testes/determinismo/hashes.test.js`.
- Modificar: `app/compose.yml`, que ganha `preparar` e `app` exatamente como na §4.1, com `APP_PORTA` em `ports` **e** em `environment`, e os volumes por serviço da §4.1.

**Interfaces:**
- O Dockerfile segue a §4.1:
  - base `node:22-bookworm-slim@sha256:<digest>`, com o digest do índice multiarquitetura obtido por `docker buildx imagetools inspect node:22-bookworm-slim` e registrado num comentário com a data;
  - estágio `web` e estágio de execução;
  - `npm ci --omit=dev --ignore-scripts` na raiz e depois `rm -rf node_modules/@tensorflow`;
  - `mkdir` e `chown` antes de `USER node`;
  - `COPY` explícitos.
- Playwright:
  - `baseURL: http://127.0.0.1:${APP_PORTA}`;
  - projetos `chromium` e `webkit`, com `reducedMotion: 'reduce'`;
  - `outputDir` e o relatório em pastas ignoradas.
- O `capturas.spec.js` gera 5 PNGs em `app/docs/capturas/` (Perfis, Onboarding, Top 10, Detalhe, Sobre) com o "Perfil de exemplo". Só tem cartazes gerados, então pode ser versionado.
- O workflow `app.yml` tem os jobs:
  - `testes` (Linux): `npm test` e `test:web`, `npm run test:integracao` contra um `db` do Compose, e `equivalencia` com o ML-100K baixado e guardado em cache pelo sha256;
  - `congelamento`: `fetch-depth: 0` e os diffs da Tarefa 1, rodados da raiz **e** de `app/`;
  - `instalacao-limpa`: os passos da §13, critério 1, com `APP_PORTA=3317`, sobre o commit do próprio CI (o checkout já é uma revisão commitada), mais as verificações de que `docker compose config` não publica a 5432, de que a imagem não tem `.env`, `app/.env`, `.git` nem `resultados/`, de que a senha não aparece em `docker compose logs`, e de que o retrato de `git status --porcelain` depois da suíte é igual ao de antes (critério (a));
  - `multiplataforma`: Windows, macOS e Linux, com `npm ci --ignore-scripts` na raiz e em `app/`, mais `node --test app/testes/determinismo/hashes.test.js`;
  - `imagem-arm64`: `docker/setup-qemu-action` e `docker/setup-buildx-action` (que cria um builder `docker-container`, necessário para várias plataformas) e, **a partir da raiz do repositório**, o comando padronizado `docker buildx build --platform linux/amd64,linux/arm64 -f app/Dockerfile .`, sem `--push` e sem `--load`. O resultado fica só no cache do builder. É o mesmo comando do Passo 5 local.

- [ ] **Passo 1: escrever o teste de determinismo.** Em `hashes.test.js`, ignorado sem `ML100K_DIR`, confere o sha256 dos 5 arquivos e `regua.hash`, `hashAvaliacoes(treino)` e `hashVetoresFC(construirFC(treino, 943))` iguais a `HASHES`.
- [ ] **Passo 2: escrever `fluxo.spec.js`.** Ele cobre o fluxo principal da §12 (linha "Ponta a ponta") passo a passo, incluindo:
  - "sem nenhum clique a lista volta a ter 10";
  - "duas notas seguidas";
  - "nota 2 sai do top";
  - "Desfazer";
  - "Ver um exemplo";
  - o perfil vazio;
  - as estrelas pelo teclado;
  - **nenhuma requisição fora de localhost** (`page.on('request')` registra os hosts);
  - o caminho bloqueado → "Apagar perfis e avaliações" → excluir. O bloqueio é provocado por um `docker compose exec db psql … UPDATE v2_final.metadados …` no `beforeAll` do bloco, e o `afterAll` restaura.
- [ ] **Passo 3: completar o Compose e o Dockerfile.** Rodar `cd app && APP_PORTA=3317 docker compose up -d --build` e esperar `/api/saude` responder `operante`, consultando por `curl -H "Host: localhost:3317" http://127.0.0.1:3317/api/saude`.
- [ ] **Passo 4: rodar o ponta a ponta.** Rodar `APP_PORTA=3317 npm run e2e`, esperar PASS em Chromium e WebKit, e rodar `npx playwright test capturas` para gerar as capturas.
- [ ] **Passo 5: build multiplataforma local.** A partir da **raiz**, rodar `docker buildx create --use --name recomendacao-multi` (uma vez) e depois `docker buildx build --platform linux/amd64,linux/arm64 -f app/Dockerfile .`. O esperado é que os dois alvos construam sem erro.
- [ ] **Passo 6: commit** com a mensagem `feat(app): imagem, compose completo, ponta a ponta, capturas e CI`. Depois, `git status --porcelain` tem de sair vazio (critério (b)), e os testes de congelamento têm de dar PASS.
- [ ] **Passo 7: verificação local da instalação limpa, sobre a revisão commitada.**
  1. Anotar `REV=$(git rev-parse HEAD)`.
  2. Rodar `git clone --no-local --branch app-etapa1 <raiz> <pasta temporária fora do repositório>` e conferir que `git -C <clone> rev-parse HEAD` é igual a `$REV` e que o clone não tem `data/`, `artefatos/`, `.env` nem `node_modules/`.
  3. No clone, rodar `cd app && APP_PORTA=3318 docker compose -p recomendacao-app-clone up -d --build`, esperar `operante` e rodar `APP_PORTA=3318 npx playwright test fluxo --project=chromium`.
  4. Rodar `docker compose -p recomendacao-app-clone down -v` e apagar o clone.
  5. Anotar no relatório o `$REV` e o tempo da primeira preparação.
- [ ] **Passo 8: se o Passo 7 falhar,** corrigir no repositório, fazer um **novo commit**, sem `--amend`, e repetir o Passo 7 com o novo `$REV`. Nada vai para o remoto: o `push` continua proibido.

---

### Tarefa 17: Documentação e aceite manual

**Arquivos:**
- Criar: `app/README.md`.
- Modificar: `README.md` da raiz, só com uma seção curta **no topo** (as capturas, uma frase sobre por que não há site público e o link para `app/README.md`). Nenhum número da pesquisa muda.

**Conteúdo exigido em `app/README.md`:**
- pré-requisitos e os três comandos da §8;
- o tempo medido na Tarefa 16;
- as tarefas comuns: parar, apagar tudo, refazer a preparação, porta ocupada (os três jeitos) e zip local;
- os problemas comuns, cada um com a mensagem exata: sem internet no build, sem internet na preparação, hash que não confere, credenciais e porta;
- o aviso de não expor a aplicação na rede e a recomendação de Docker ≥ 28 no Linux;
- a frase sobre o `u1.base` e o teste-2 (§10.8);
- o que é igual à S1 avaliada e o que muda: o conjunto de exclusão e o índice reconstruído (§4.4);
- o que foi medido e o que não se transfere;
- as licenças e a citação de Harper & Konstan (2015);
- uma nota de que cartazes reais não estão disponíveis, porque nenhum fornecedor com licença compatível foi encontrado (§11.2), sem instruções de TMDB;
- o modo de desenvolvimento (`compose.dev.yml`).

- [ ] **Passo 1:** escrever os dois READMEs.
- [ ] **Passo 2: conferir que nenhum número da pesquisa mudou.** Rodar `git diff COMMIT_PESQUISA HEAD -- README.md` e confirmar que só a seção nova aparece.
- [ ] **Passo 3: commit** com a mensagem `docs(app): guia da aplicação e seção no README`.
- [ ] **Passo 4: aceite manual.** Este passo é **do usuário**: o agente prepara o roteiro e registra o resultado.
  - Num clone novo, em Windows com Docker Desktop (e, se houver acesso, em Mac ARM), seguir só o `app/README.md`.
  - Registrar em `app/docs/aceite-manual.md` a data, a versão do Docker, o sistema, o tempo da primeira preparação e o resultado de cada passo.
  - O GIF de 60 a 90 s é gravado pelo usuário a partir desse roteiro e adicionado a `app/docs/`.
- [ ] **Passo 5: commit do registro de aceite**, com a mensagem `docs(app): registro do aceite manual`.

---

## Estratégia de execução (aprovada pelo usuário em 2026-11-16)

- **Uma tarefa por vez:** um subagente implementador por tarefa, que recebe a spec v3.1, o texto da tarefa e o estado atual do repositório.
- **Revisão de cada tarefa:** um subagente revisor **independente**, instruído a procurar defeitos e regressões, e não a confirmar o trabalho. Ele confere a spec, o plano e estas restrições globais.
- **Achados:** são corrigidos antes do commit final da tarefa e antes de avançar para a próxima.
- **Testes:** demonstram os requisitos. É proibido enfraquecer, apagar ou adaptar um teste para aceitar uma implementação incorreta. Um teste só muda se estiver em desacordo com a spec, e a mudança fica registrada no relatório da tarefa com a justificativa.
- **Revisões de integração obrigatórias** depois das Tarefas **7** (preparação completa), **12** (servidor completo) e **16** (instalação limpa e CI). Cada uma olha o conjunto acumulado: contratos entre as tarefas, isolamento, congelamento e o critério (a) da árvore git.
- **Ao fim:** uma revisão adversarial do branch inteiro.
- **Sempre valem:**
  - os arquivos científicos congelados não mudam;
  - o trabalho fica no branch `app-etapa1`, **sem push** sem autorização do usuário;
  - o TMDB fica fora da implementação (§11.2).

## Rastreabilidade entre a spec e as tarefas

| Spec | Tarefas |
|---|---|
| §4.1 serviços, imagem e `.dockerignore` | 1, 3, 16 |
| §4.2 preparação | 4, 5, 6, 7 |
| §4.3 servidor, vigia e gestão restrita | 9, 11 |
| §4.4 pipeline e explicações | 8, 12 |
| §5 banco e papéis | 3, 6 |
| §6 API | 9–12 |
| §7 frontend | 13–15 |
| §8 instalação e §9 segurança | 3, 9, 16, 17 |
| §10.1–10.4 isolamento e congelamento | 1, 12, 16 |
| §10.5 equivalência | 8 |
| §10.6 integridade | 5, 9, 11, 16 |
| §10.7 determinismo | 16 |
| §10.8 `u1.base` | 16 (volumes), 17 |
| §11 mídia | 10, 13 |
| §13 critérios de aceite | 16, 17 |
