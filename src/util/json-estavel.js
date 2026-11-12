// JSON com as chaves dos objetos sempre em ordem alfabética, em todos os níveis.
// O JSON.stringify comum segue a ordem em que as chaves foram criadas; aqui a saída é sempre
// a mesma para o mesmo conteúdo, o que permite calcular um hash estável (base do hash da régua).

// Copia o valor recursivamente, ordenando as chaves de cada objeto.
function ordenar(v) {
  if (Array.isArray(v)) return v.map(ordenar);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar(v[k])]));
  }
  return v;
}

/** Converte para texto JSON com chaves ordenadas (saída determinística). */
export function jsonEstavel(obj) {
  return JSON.stringify(ordenar(obj));
}
