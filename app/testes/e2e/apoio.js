// Apoio dos testes de ponta a ponta: fixture de rede, ajudantes de API e o acesso ao banco para o caminho bloqueado.
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, request as requisicao, test as base } from '@playwright/test';

export const PREFIXO = 'E2E ';
const aqui = path.dirname(fileURLToPath(import.meta.url));
export const DIR_APP = path.resolve(aqui, '..', '..');
const HOSTS_PERMITIDOS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * `test` com a fixture automática `trafego`: registra toda requisição do navegador (page.on('request')) e, ao fim de
 * cada teste, confere que nenhuma saiu para fora de localhost. Quem precisar olhar os cabeçalhos usa `trafego.api`.
 */
export const test = base.extend({
  trafego: [
    async ({ page }, use) => {
      const t = { hosts: new Set(), api: [] };
      page.on('request', (r) => {
        const u = new URL(r.url());
        if (u.protocol === 'http:' || u.protocol === 'https:') t.hosts.add(u.hostname === '::1' ? '[::1]' : u.hostname);
        if (u.pathname.startsWith('/api/')) t.api.push(r);
      });
      await use(t);
      const fora = [...t.hosts].filter((h) => !HOSTS_PERMITIDOS.has(h));
      expect(fora, 'hosts fora de localhost').toEqual([]);
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

// ---- acesso ao banco (só o caminho bloqueado) ----
// O comando é configurável para não depender do WSL: E2E_DOCKER (padrão `docker`) e E2E_COMPOSE_ARGS (padrão vazio;
// ex.: `-p recomendacao-app-clone` ou `-p x -f /caminho/compose.yml`). Sem -f, o Compose roda em app/.
export function psql(sql) {
  const docker = process.env.E2E_DOCKER ?? 'docker';
  const args = process.env.E2E_COMPOSE_ARGS ?? '';
  const usuario = process.env.POSTGRES_USER ?? 'recomendacao_app';
  const banco = process.env.POSTGRES_DB ?? 'recomendacao_app';
  const cmd = `${docker} compose ${args} exec -T db psql -U ${usuario} -d ${banco} -v ON_ERROR_STOP=1 -tA`;
  return execSync(cmd, { cwd: DIR_APP, input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
