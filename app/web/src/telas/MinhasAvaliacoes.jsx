import ListaInteracoes from '../componentes/ListaInteracoes.jsx';

/** As notas e os "Gostei" do perfil, com edição e exclusão. */
export default function MinhasAvaliacoes({ perfilId }) {
  return (
    <section className="minhas-avaliacoes" aria-labelledby="titulo-minhas-avaliacoes">
      <h1 id="titulo-minhas-avaliacoes">Minhas avaliações</h1>
      <ListaInteracoes
        perfilId={perfilId}
        tipos="nota,gostei"
        modo="avaliacoes"
        vazio="Você ainda não avaliou nenhum filme. Dê notas ou marque 'Gostei' no catálogo."
      />
    </section>
  );
}
