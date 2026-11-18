# Relatório da Tarefa 12

Status: concluída. Commit b82ba1f (rota, diagnóstico, fecho, testes) e um commit com a evidência RED e este relatório.

## Entregue
- app/servidor/rotas/recomendacoes.js: GET /api/perfis/:id/recomendacoes (ignora a query; erros da busca sobem ao tratador do app, que usa ciclo.registrarErro: 503 BANCO_INDISPONIVEL ou BLOQUEADO). baseadoEm = até 5 curtidos com vetor, mais recentes primeiro. busca = null quando não houve busca.
- app/servidor/rotas/diagnostico.js: GET /api/diagnostico/busca?perfilId= com { hnsw, exata, sobreposicao } (top N_FC=150 de cada modo, sobreposição = |∩|/|exata|; perfil sem vetor: listas vazias e sobreposicao null). Registrada em app.js só com APP_DIAGNOSTICO=1 (opção `diagnostico` de construirApp, padrão lido do ambiente).
- app/testes/apoio/fecho-gancho.js e fecho-registrar.js (module.register); app/testes/fecho.test.js (3 testes, incluído no `npm test` em package.json de app/); app/testes/integracao/recomendacoes.test.js (13 testes, banco app_teste_recomendacoes).
- RED: .superpowers/sdd/2026-11-16-aplicacao-etapa1/task-12-red.txt (13 testes, 12 falharam).

## Lista do fecho do script 16
Derivada pelo próprio gancho rodando scripts/16-carregar-v2.js sem --fase (resolve os imports estáticos e sai com 1). Não achei a lista na spec/plano/revisão. O fecho real tem 16 arquivos de src/ (não 17): banco/{carga-fc,carga,conexao}, config, contexto, dados/{carregar,divisoes,estatisticas,leitura,teste2}, fc/referencia, features/{codificacao,regua}, util/{aleatorio,hash-avaliacoes,json-estavel}.
O fecho real de app/preparar/preparar.js é um subconjunto disso (não carrega banco/*, config.js nem codificacao.js), mais src/candidatos/populares.js (permitido pela §10.1), e não importa src/dados/download.js (tem download próprio). Por isso o teste exige que o fecho esteja DENTRO da lista permitida de 18 (16 + populares + download), não igualdade. Um terceiro teste confere que a lista de 16 é igual ao fecho real do script 16.

## Testes
npm test: 183 (182 pass, 0 fail, 1 skip). npm run test:integracao: 134 pass, 0 fail.
