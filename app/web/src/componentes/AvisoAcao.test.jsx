import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ProvedorAviso, useAviso } from './AvisoAcao.jsx';

function Disparador({ desfazer }) {
  const { mostrar } = useAviso();
  return <button onClick={() => mostrar({ texto: 'Salvo', desfazer })}>disparar</button>;
}

describe('AvisoAcao', () => {
  test('Desfazer chama a função e some em 6 s', () => {
    vi.useFakeTimers();
    const desfazer = vi.fn();
    const { container } = render(<ProvedorAviso><Disparador desfazer={desfazer} /></ProvedorAviso>);
    const regiao = container.querySelector('[aria-live="polite"]');
    expect(regiao).toBeTruthy();
    expect(container.querySelectorAll('[aria-live]').length).toBe(1);
    fireEvent.click(screen.getByText('disparar'));
    expect(regiao.textContent).toContain('Salvo');
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(desfazer).toHaveBeenCalledTimes(1);
    expect(regiao.textContent).toBe('');

    fireEvent.click(screen.getByText('disparar'));
    act(() => { vi.advanceTimersByTime(5900); });
    expect(regiao.textContent).toContain('Salvo');
    act(() => { vi.advanceTimersByTime(200); });
    expect(regiao.textContent).toBe('');
    expect(container.querySelector('[aria-live="polite"]')).toBe(regiao);
  });
});
