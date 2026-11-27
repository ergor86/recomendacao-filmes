# Guia do projeto: Recomendação de Filmes

Este guia explica o projeto **por dentro**. Para instalar a aplicação ou preparar o ambiente da pesquisa, comece pelo [README da raiz](../../README.md). O guia não substitui os documentos que já existem (as specs em [`docs/superpowers/specs/`](../superpowers/specs/) e o [README dos resultados](../../resultados/README.md)), que são a fonte oficial e detalhada. O guia **organiza e explica** esse material: mostra como as peças se encaixam, de onde vem cada arquivo e quais conceitos de Machine Learning estão por trás de cada decisão.

## Como ler

| Se você quer… | Leia |
|---|---|
| Entender o projeto em 5 minutos | [1. Visão geral](01-visao-geral.md) |
| Saber o que cada pasta e arquivo faz, e quem usa quem | [2. Mapa do repositório](02-mapa-do-repositorio.md) |
| Seguir a ordem em que os scripts rodam e o que cada um grava | [3. Pipeline da pesquisa](03-pipeline-da-pesquisa.md) |
| Aprender os conceitos (cosseno, HNSW, filtragem colaborativa, NDCG, bootstrap…) | [4. Fundamentos teóricos](04-fundamentos.md) |
| Ver o que foi testado, o que deu certo, o que foi descartado e por quê | [5. Experimentos e decisões](05-experimentos-e-decisoes.md) |
| Entender a aplicação "Minha Prateleira" | [6. A aplicação](06-aplicacao.md) |
| Consultar um termo (S1, fase `v2-exp`, régua, portão, gêmeos…) | [7. Glossário](07-glossario.md) |
| Ver o comando exato, a sequência que rodou ou a lista completa de limitações | [8. Registro completo da pesquisa](08-registro-completo.md) |

Sugestão para quem está começando: 1 → 4 → 3 → 5. O capítulo 4 foi escrito para quem nunca estudou recomendação; os outros pressupõem que você já leu a visão geral.

## Convenções

- **Caminhos** são relativos à raiz do repositório (`src/fc/referencia.js`, `resultados/avaliacao-v2.json`).
- **Números** foram copiados dos arquivos de `resultados/` e do [registro completo](08-registro-completo.md). Quando há diferença, os arquivos JSON valem.
- **Diagramas** usam [Mermaid](https://mermaid.js.org/), que o GitHub desenha automaticamente. Em editores locais, use uma extensão de pré-visualização de Markdown com suporte a Mermaid.
- O guia descreve o estado do repositório na conclusão da **etapa 1 da aplicação** (novembro de 2026).

## O que fica fora do git

Algumas pastas existem só na máquina de quem rodou o projeto, por licença ou por tamanho (ver `.gitignore`):

| Pasta | Por que fica fora | Como recriar |
|---|---|---|
| `data/` | A licença do MovieLens não permite redistribuir | `npm run baixar-dados` |
| `artefatos/` | Arquivos intermediários grandes (candidatos, réguas, previsões) | Rodar os scripts da fase correspondente |
| `modelos/` | Pesos das redes treinadas (vários MB por modelo) | `npm run treinar` |
| `.superpowers/` | Diário de execução dos agentes de IA (briefs, relatórios, revisões) | Não é recriável; é registro histórico local |


A pasta `.playwright-mcp/` (capturas de tela e registros das verificações visuais da aplicação) **não** está no `.gitignore`. Ela não é necessária para rodar nada. Decida se quer versioná-la ou acrescentá-la ao `.gitignore`.
