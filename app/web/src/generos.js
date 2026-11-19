// Rótulos em português dos gêneros (os mesmos 18 + "unknown" de GET /api/generos), para exibir nos cartões.
export const ROTULOS_GENEROS = Object.freeze({
  action: 'Ação', adventure: 'Aventura', animation: 'Animação', "children's": 'Infantil', comedy: 'Comédia',
  crime: 'Crime', documentary: 'Documentário', drama: 'Drama', fantasy: 'Fantasia', 'film-noir': 'Noir',
  horror: 'Terror', musical: 'Musical', mystery: 'Mistério', romance: 'Romance', 'sci-fi': 'Ficção científica',
  thriller: 'Suspense', war: 'Guerra', western: 'Faroeste', unknown: 'Desconhecido',
});

export const rotuloGenero = (id) => ROTULOS_GENEROS[String(id).toLowerCase()] ?? String(id);
