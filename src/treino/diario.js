// Diário de treinos (resultados/diario-treinos.jsonl): uma linha JSON por execução do script 09.
// Serve para auditar retreinos: rodar de novo um modelo (mesmo nome e fase) exige um motivo explícito.

/**
 * Decide o motivo a registrar no diário. `conteudoDiario` é o texto do .jsonl ('' se não existe);
 * `motivoInformado` é o valor de --motivo (null se não foi passado).
 * Primeira execução de (nome, fase) sem --motivo: 'planejado'. Já existe linha com o mesmo nome e fase e
 * não veio --motivo: erro acionável (retreino fora do plano exige motivo).
 */
export function motivoDoTreino(conteudoDiario, { nome, fase, motivoInformado }) {
  if (motivoInformado != null) return motivoInformado;
  const anteriores = conteudoDiario.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
    .filter((l) => l.nome === nome && l.fase === fase);
  if (anteriores.length > 0) {
    throw new Error(`o diário já tem ${anteriores.length} treino(s) de ${nome} na fase ${fase} (último em ${anteriores.at(-1).data}): `
      + 'um retreino fora do plano exige --motivo "<texto>" (ou use --saida <pasta> para um teste que não entra no diário)');
  }
  return 'planejado';
}
