# Aceite manual: roteiro e registro

Este arquivo é preenchido pela pessoa que executa o aceite (spec §13, critério 1). O roteiro segue só o `app/README.md`, sem ajuda de quem escreveu o código. O GIF de 60 a 90 s é gravado a partir deste roteiro e guardado em `app/docs/`.

## Roteiro

Num clone novo, sem `.env` e sem dados anteriores, em Windows com Docker Desktop (e, se houver acesso, em Mac ARM):

1. Conferir os pré-requisitos do README (Docker, 3 GB livres, internet).
2. Clonar e entrar em `app/`. Enquanto o PR #4 não for incorporado à `main`, a `main` ainda não tem a pasta `app/`; clone a branch:
   ```
   git clone -b app-etapa1 --single-branch https://github.com/ergor86/recomendacao-filmes.git
   cd recomendacao-filmes/app
   ```
   Depois do merge, vale o comando do README: `git clone https://github.com/ergor86/recomendacao-filmes.git`. Anote no registro qual dos dois foi usado e o commit (`git log -1 --format=%h`).
3. `docker compose up --build`. Marcar o tempo até aparecer `Pronto: abra http://localhost:3000`.
4. Abrir http://localhost:3000 e acompanhar a tela de preparação até a aplicação abrir.
5. Criar um perfil, marcar 3 filmes com "Gostei" e conferir o Top 10 com "Porque você curtiu".
6. Dar 5 estrelas a um item do Top 10 (ele sai da lista), usar "Quero assistir" em outro e testar o "Desfazer".
7. Abrir "Ver um exemplo" e a tela Sobre (conferir as 3 frases do topo e a atribuição ao GroupLens).
8. `Ctrl+C` e `docker compose up` de novo: a preparação deve levar poucos segundos e os perfis continuam lá.
9. Porta ocupada: `APP_PORTA=3001` (ou `$env:APP_PORTA=3001` no PowerShell) e abrir http://localhost:3001.
10. Opcional: desligar a internet depois da instalação e conferir que a aplicação segue funcionando.
11. `docker compose down -v` para apagar tudo.

## Registro

Preencher uma cópia deste bloco por sistema testado. Nada abaixo foi preenchido.

| Campo | Valor |
|---|---|
| Data | |
| Comando de clone usado (branch ou `main`) e commit testado | |
| Versão do Docker (`docker version`) | |
| Sistema (nome e versão; arquitetura) | |
| Tempo da primeira preparação (do `up --build` até `Pronto`) | |

| Passo | Resultado (passou / falhou) | Observações |
|---|---|---|
| 1. Pré-requisitos | | |
| 2. Clone | | |
| 3. `docker compose up --build` | | |
| 4. Tela de preparação até abrir | | |
| 5. Perfil, 3 "Gostei" e Top 10 | | |
| 6. 5 estrelas, "Quero assistir", "Desfazer" | | |
| 7. Exemplo e Sobre | | |
| 8. Parar e retomar | | |
| 9. Porta alternativa | | |
| 10. Funcionamento offline (opcional) | | |
| 11. `down -v` | | |

Observações gerais (mensagens inesperadas, trechos do README confusos, sugestões):

