// Gancho de carregamento (module.register) da camada (b), Ruling 14: o fecho de
// src/avaliacao/fidelidade.js chega a src/modelo/rede.js, que importa o TensorFlow nativo. A
// conferência de precisão não usa a rede, então o pacote vira um módulo vazio que só marca
// globalThis.__tfSubstituido. Isso evita o binário nativo, que não existe no CI com --ignore-scripts.
const ALVO = '@tensorflow/' + 'tfjs-node';
const VAZIO = 'data:text/javascript,globalThis.__tfSubstituido%3Dtrue%3Bexport%20default%20%7B%7D';

export async function resolve(especificador, contexto, proximo) {
  if (especificador === ALVO) return { url: VAZIO, shortCircuit: true };
  return proximo(especificador, contexto);
}
