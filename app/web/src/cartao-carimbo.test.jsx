import { test, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CartaoFilme from './componentes/CartaoFilme.jsx';

const filme = (estadoPerfil) => ({ id: 1, titulo: 'Fargo', ano: 1996, generos: ['Crime'], temVetor: true, estadoPerfil });

test('carimbo decorativo só quando o estado é Gostei', () => {
  const a = render(<MemoryRouter><CartaoFilme filme={filme({ tipo: 'gostei' })} /></MemoryRouter>);
  const c = a.container.querySelector('.carimbo-gostei');
  expect(c).toBeTruthy();
  expect(c.getAttribute('aria-hidden')).toBe('true');
  a.unmount();
  const b = render(<MemoryRouter><CartaoFilme filme={filme({ tipo: 'nota', nota: 5 })} /></MemoryRouter>);
  expect(b.container.querySelector('.carimbo-gostei')).toBeNull();
});
