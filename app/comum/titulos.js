const ARTIGOS = ['The', 'A', 'An', 'La', 'Le', 'Les', 'Il', 'Das', 'Der', 'Die', 'El', "L'"];
const RE_ANO = /\s*\((\d{4})\)\s*$/;
const RE_ARTIGO_FINAL = new RegExp(`^(.*), (${ARTIGOS.map((a) => a.replace("'", "\\'")).join('|')})$`);
const RE_ALIAS_FINAL = /\s*\([^()]*\)\s*$/;

function semAno(titulo) {
  return String(titulo).replace(RE_ANO, '').trim();
}

function moverArtigo(t) {
  const m = RE_ARTIGO_FINAL.exec(t);
  if (!m) return t;
  return m[2] === "L'" ? `L'${m[1]}` : `${m[2]} ${m[1]}`;
}

export function tituloExibicao(tituloOriginal) {
  let t = String(tituloOriginal);
  const tinhaAno = RE_ANO.test(t);
  t = semAno(t);
  // alias entre parênteses antes do ano (ex.: "Seven (Se7en)"): só quando havia ano
  if (tinhaAno) t = t.replace(RE_ALIAS_FINAL, '').trim();
  return moverArtigo(t);
}

function normalizar(s) {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function tituloBusca(tituloOriginal) {
  const original = normalizar(semAno(tituloOriginal));
  const exibicao = normalizar(tituloExibicao(tituloOriginal));
  return original === exibicao ? original : `${original} ${exibicao}`;
}
