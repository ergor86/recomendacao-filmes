// Mídia (spec 11.1): interface `midia(filme) → Midia` e registro MIDIA_FORNECEDOR (padrão `local`).
// Só existe o fornecedor local: o SVG gerado no navegador é o padrão, não um substituto provisório.
// Nenhum adaptador de terceiros existe no código; um nome desconhecido é recusado.
const LOCAL = Object.freeze({
  midia: () => ({ cartaz: { tipo: 'gerado' }, sinopse: null, atribuicao: null }),
});

const FORNECEDORES = Object.freeze({ local: LOCAL });

export function criarFornecedorMidia(nome = process.env.MIDIA_FORNECEDOR ?? 'local') {
  if (!Object.hasOwn(FORNECEDORES, nome)) throw new Error(`MIDIA_FORNECEDOR desconhecido: ${nome}`);
  return FORNECEDORES[nome];
}
