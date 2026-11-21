import ListaInteracoes from '../componentes/ListaInteracoes.jsx';

/** Os filmes marcados como "Quero assistir". */
export default function MinhaLista({ perfilId }) {
  return (
    <section className="minha-lista" aria-labelledby="titulo-minha-lista">
      <h1 id="titulo-minha-lista">Minha lista</h1>
      <ListaInteracoes
        perfilId={perfilId}
        tipos="quero_assistir"
        modo="lista"
        vazio="Sua lista está vazia. Use 'Quero assistir' no catálogo para guardar filmes aqui."
      />
    </section>
  );
}
