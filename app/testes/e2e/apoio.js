// Apoio dos testes de ponta a ponta: fixture de rede, ajudantes de API e o acesso ao banco para o caminho bloqueado.
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, request as requisicao, test as base } from '@playwright/test';

export const PREFIXO = 'E2E ';
const aqui = path.dirname(fileURLToPath(import.meta.url));
export const DIR_APP = path.resolve(aqui, '..', '..');
const HOSTS_PERMITIDOS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Quantos tipos de conteúdo guardamos do tráfego (o "HAR em memória" da conferência de segredos). */
const TIPOS_TEXTO = /^(text\/|application\/(json|javascript|xml))/;

let credenciaisCache; // undefined = ainda não lidas; null = indisponíveis; array = as senhas
/** Senhas de credenciais.json (volume de estado do app), lidas uma vez por `docker compose exec`. Nunca são impressas. */
export function senhasDeCredenciais() {
  if (credenciaisCache !== undefined) return credenciaisCache;
  try {
    const json = JSON.parse(compose('exec -T app cat /var/app/estado/credenciais.json'));
    credenciaisCache = Object.values(json).filter((v) => typeof v === 'string' && v.length >= 16);
    if (credenciaisCache.length === 0) credenciaisCache = null;
  } catch {
    credenciaisCache = null;
  }
  return credenciaisCache;
}
const EXIGIR_SEGREDOS = process.env.E2E_EXIGIR_SEGREDOS === '1'; // o CI define: sem as senhas a conferência FALHA

/**
 * `test` com a fixture automática `trafego`: registra o que o navegador envia e recebe e, ao fim de cada teste, confere
 * que (1) nenhuma requisição saiu para fora de localhost, (2) a CSP não barrou nada (securitypolicyviolation e erros de
 * console de CSP: uma requisição externa barrada antes de sair não aparece em page.on('request')) e (3) nenhuma senha de
 * credenciais.json aparece nas requisições (URL, cabeçalhos, corpo) nem nas respostas de texto. O HAR do Playwright só é
 * gravado ao fechar o contexto, depois da desmontagem das fixtures; por isso a captura é feita aqui, em memória.
 * Quem precisar olhar os cabeçalhos usa `trafego.api`.
 */
export const test = base.extend({
  trafego: [
    async ({ page }, use) => {
      const t = { hosts: new Set(), api: [], csp: [], captura: [] };
      const pendentes = [];
      await page.exposeFunction('__registrarCsp', (m) => t.csp.push(m));
      await page.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (e) => {
          window.__registrarCsp(`${e.violatedDirective} bloqueou ${e.blockedURI}`);
        });
      });
      page.on('console', (m) => {
        if (m.type() === 'error' && /content security policy|refused to (load|connect|apply|execute)/i.test(m.text())) t.csp.push(m.text());
      });
      page.on('request', (r) => {
        const u = new URL(r.url());
        if (u.protocol === 'http:' || u.protocol === 'https:') t.hosts.add(u.hostname === '::1' ? '[::1]' : u.hostname);
        if (u.pathname.startsWith('/api/')) t.api.push(r);
        pendentes.push(
          r.allHeaders().then((h) => t.captura.push(r.url(), JSON.stringify(h), r.postData() ?? '')).catch(() => {}),
        );
      });
      page.on('response', (r) => {
        const tipo = r.headers()['content-type'] ?? '';
        if (!TIPOS_TEXTO.test(tipo)) return;
        pendentes.push(r.text().then((c) => t.captura.push(JSON.stringify(r.headers()), c)).catch(() => {}));
      });
      await use(t);
      await Promise.allSettled(pendentes);
      const fora = [...t.hosts].filter((h) => !HOSTS_PERMITIDOS.has(h));
      expect(fora, 'hosts fora de localhost').toEqual([]);
      expect(t.csp, 'violações da CSP').toEqual([]);
      const senhas = senhasDeCredenciais();
      if (senhas) {
        const blob = t.captura.join('\n');
        // só booleanos nas mensagens: as senhas nunca aparecem num relatório de falha
        expect(senhas.some((x) => blob.includes(x)), 'senha de credenciais.json no tráfego do navegador').toBe(false);
      } else {
        expect(EXIGIR_SEGREDOS, 'E2E_EXIGIR_SEGREDOS=1 mas credenciais.json não pôde ser lida (docker compose exec app)').toBe(false);
      }
    },
    { auto: true },
  ],
});
export { expect };

/** Pedidos da API com método e caminho (sem consulta) e, quando existirem, o Content-Type e o corpo. */
export async function resumirPedidos(pedidos) {
  const saida = [];
  for (const r of pedidos) {
    const cab = await r.allHeaders();
    saida.push({
      metodo: r.method(),
      caminho: new URL(r.url()).pathname,
      contentType: cab['content-type'] ?? null,
      corpo: r.postData(),
    });
  }
  return saida;
}

export const nomeUnico = (rotulo) => `${PREFIXO}${rotulo} ${Date.now().toString(36)}`;

export async function contextoApi(baseURL) {
  return requisicao.newContext({ baseURL });
}

/** Apaga (pela API, em cascata) todos os perfis criados pelos testes. O "Perfil de exemplo" fica. */
export async function limparPerfisDeTeste(baseURL) {
  const api = await contextoApi(baseURL);
  try {
    const resp = await api.get('/api/perfis');
    if (!resp.ok()) return;
    for (const p of await resp.json()) {
      if (p.nome.startsWith(PREFIXO)) await api.delete(`/api/perfis/${p.id}`);
    }
  } finally {
    await api.dispose();
  }
}

// ---- acesso ao banco e ao Compose ----
// O comando é configurável para não depender do WSL: E2E_DOCKER (padrão `docker`) e E2E_COMPOSE_ARGS (padrão vazio;
// ex.: `-p recomendacao-e2e -f /caminho/compose.yml`). Sem -f, o Compose roda em app/.
function execCompose(sub, input) {
  const docker = process.env.E2E_DOCKER ?? 'docker';
  const args = process.env.E2E_COMPOSE_ARGS ?? '';
  return execSync(`${docker} compose ${args} ${sub}`, { cwd: DIR_APP, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
}
export const compose = (sub) => execCompose(sub);

export function psql(sql) {
  const usuario = process.env.POSTGRES_USER ?? 'recomendacao_app';
  const banco = process.env.POSTGRES_DB ?? 'recomendacao_app';
  return execCompose(`exec -T db psql -U ${usuario} -d ${banco} -v ON_ERROR_STOP=1 -tA`, sql).trim();
}

// ---- trava do caminho bloqueado ----
// O bloco "caminho bloqueado" ADULTERA `v2_final.metadados` (hash_treino) do banco alvo e cria/apaga perfis. Com os
// padrões acima o alvo é o projeto `recomendacao-app`: a instalação real da pessoa. Por isso o bloco só roda com
// E2E_PERMITIR_BLOQUEIO=1 (o CI define; num clone ou projeto de teste, ex.: E2E_COMPOSE_ARGS="-p recomendacao-e2e ...").
// Sem a variável o bloco é ignorado com mensagem. RECUPERAÇÃO MANUAL, se o processo morrer entre a adulteração e a
// restauração (o banco fica "bloqueado" e o app mostra "A aplicação está bloqueada"; a próxima execução com o
// opt-in também se recupera sozinha, pois detecta o valor 'x'):
//   docker compose exec -T db psql -U recomendacao_app -d recomendacao_app -c //     "UPDATE v2_final.metadados SET valor = '<HASHES.treino de app/integridade.js>' WHERE chave = 'hash_treino';"
// ou, sem conhecer o valor:  docker compose run --rm preparar   e depois "Conferir de novo" na tela.
export const PERMITIR_BLOQUEIO = process.env.E2E_PERMITIR_BLOQUEIO === '1';
export const MOTIVO_SEM_BLOQUEIO =
  'caminho bloqueado ignorado: altera hash_treino do banco alvo (a instalação real, com os padrões). ' +
  'Defina E2E_PERMITIR_BLOQUEIO=1 (e aponte E2E_COMPOSE_ARGS para um projeto de teste) para executá-lo.';
