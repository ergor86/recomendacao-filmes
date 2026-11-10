// JSON com chaves ordenadas recursivamente (saída determinística, base do hash da régua).
function ordenar(v) {
  if (Array.isArray(v)) return v.map(ordenar);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordenar(v[k])]));
  }
  return v;
}

export function jsonEstavel(obj) {
  return JSON.stringify(ordenar(obj));
}
