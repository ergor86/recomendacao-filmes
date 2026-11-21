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

Preencher uma cópia deste bloco por sistema testado.

### Sistema 1: Windows com Docker Engine no WSL2 (Ubuntu)

Transcrito do arquivo de respostas do executor (André de Souza Rosa). Só foram corrigidas a digitação e a pontuação, e as listas do Top 10 foram resumidas aos títulos. Campos que ele deixou em branco continuam em branco.

| Campo | Valor |
|---|---|
| Data | 21/11/2026 |
| Comando de clone usado (branch ou `main`) e commit testado | `git clone -b app-etapa1 --single-branch https://github.com/ergor86/recomendacao-filmes.git` (commit no clone: `da5175a`, conferido por quem transcreveu) |
| Versão do Docker (`docker version`) | Docker version 29.9.3, build 5457199 |
| Sistema (nome e versão; arquitetura) | Ubuntu 26.04.1 LTS; x86_64; kernel 6.18.58.1-microsoft-standard-WSL2 |
| Tempo da primeira preparação (do `up --build` até `Pronto`) | poucos segundos; o build: Building 10.2s (29/29) FINISHED |

| Passo | Resultado (passou / falhou) | Observações |
|---|---|---|
| 1. Pré-requisitos | rodei no WSL e não tive problemas | |
| 2. Clone | passou | |
| 3. `docker compose up --build` | passou | |
| 4. Tela de preparação até abrir | passou | demorou poucos segundos |
| 5. Perfil, 3 "Gostei" e Top 10 | passou | o app está permitindo cadastrar dois perfis com o mesmo nome; o ideal é que cada perfil seja único |
| 6. 5 estrelas, "Quero assistir", "Desfazer" | passou | fiz o processo para o mesmo filme: ao clicar em "Quero assistir", as estrelas ficaram desmarcadas; ao desfazer, as estrelas voltaram a ficar marcadas |
| 7. Exemplo e Sobre | passou | ao clicar em "Ver um exemplo" na tela de perfis, foi gerado um novo com um Top 10 já pronto; ao clicar em Sobre, foi aberta uma tela com informações do projeto |
| 8. Parar e retomar | passou | |
| 9. Porta alternativa | passou | |
| 10. Funcionamento offline (opcional) | | |
| 11. `down -v` | passou | |

Observações gerais (mensagens inesperadas, trechos do README confusos, sugestões):

Alguns filmes aparecem com frequência nos testes, mesmo escolhendo gêneros mais "afastados". Exemplo: no perfil "Alicia", com três romances curtidos (Annie Hall, While You Were Sleeping e Jerry Maguire), o Top 10 trouxe When Harry Met Sally..., Star Wars, Back to the Future, Raiders of the Lost Ark, E.T. the Extra-Terrestrial, The Silence of the Lambs, Amadeus, Schindler's List, Forrest Gump e Rear Window. No perfil "andrepetsu", com Star Trek: First Contact, Contact e Star Wars, vieram Return of the Jedi, The Empire Strikes Back, Raiders of the Lost Ark, Toy Story, Men in Black, The Princess Bride, Independence Day, The Terminator, Fargo e The Godfather. Star Wars, Raiders of the Lost Ark e Forrest Gump aparecem com frequência nas listas.

Notas de quem acompanhou (Claude, não do executor), para a leitura correta deste registro:
- O roteiro pede Windows com Docker Desktop. Este aceite usou Docker Engine no WSL2, então não cobre o caminho do Docker Desktop.
- O roteiro pede execução sem ajuda de quem escreveu o código. O executor recebeu orientação de Claude sobre rodar os comandos no WSL e sobre como testar o passo 9.
- No passo 9, com a porta 3000 ocupada, o `docker compose up -d` falhou com `failed to bind host port 127.0.0.1:3000/tcp: address already in use`. Depois de liberar a porta, um novo `docker compose up -d` subiu o contêiner sem a porta publicada; foi preciso `docker compose up -d --force-recreate app`. O README ainda não menciona isso.

