import { execFileSync } from 'node:child_process';

function git(raiz, args) {
  return execFileSync('git', ['-C', raiz, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Compara a árvore de trabalho com `commit`, só nos `caminhos` (relativos à raiz).
 * Antes do diff, cada caminho é conferido com `git cat-file -e commit:caminho`, porque
 * o `git diff` sai com 0 também para um pathspec inexistente. Se algum caminho não
 * existir no commit, a função lança erro.
 */
export function conferirCongelamento(raiz, commit, caminhos) {
  for (const c of caminhos) {
    try {
      git(raiz, ['cat-file', '-e', `${commit}:${c}`]);
    } catch (e) {
      throw new Error(`caminho protegido inexistente em ${commit}: ${c}`, { cause: e });
    }
  }
  const pathspecs = caminhos.map((c) => `:/${c}`);
  const linhas = (saida) => saida.split('\n').map((l) => l.trim()).filter(Boolean);
  const alterados = linhas(git(raiz, ['diff', '--name-only', commit, '--', ...pathspecs]));
  // arquivos novos, ainda não rastreados (e não ignorados), nos caminhos protegidos
  for (const novo of linhas(git(raiz, ['ls-files', '--others', '--exclude-standard', '--full-name', '--', ...pathspecs]))) {
    if (!alterados.includes(novo)) alterados.push(novo);
  }
  return { ok: alterados.length === 0, alterados };
}
